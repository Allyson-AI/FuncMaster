import React, {useState, useRef} from 'react';
import {Platform, Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import DocumentPicker from 'react-native-document-picker';
import {Chat, darkTheme} from '@flyerhq/react-native-chat-ui';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {initLlama, LlamaContext, convertJsonSchemaToGrammar} from 'llama.rn';
import {Bubble} from './Bubble';
import Instruct from './Instruct';

const {dirs} = ReactNativeBlobUtil.fs;

const randId = () => Math.random().toString(36).substr(2, 9);

const user = {id: 'y9d7f8pgn'};

const systemId = 'h3o3lc5xj';
const system = {id: systemId};

const initialChatPrompt = `You are a helpful assistant with access to the following functions. Use them when a users question is related to them -\n  {\n    \"name\": \"get_stock_price\",\n    \"description\": \"Get the latest price of a stock\",\n    \"parameters\": {\n      \"type\": \"object\",\n      \"properties\": {\n        \"symbol\": {\n          \"type\": \"string\",\n          \"description\": \"The stock symbol to look up.\"\n        }\n      },\n      \"required\": [\"symbol\"]\n    }\n  }\n]\n`;

const generateChatPrompt = (context, conversationId, messages) => {
  const prompt = [...messages]
    .reverse()
    .map(msg => {
      if (
        !msg.metadata?.system &&
        msg.metadata?.conversationId === conversationId &&
        msg.metadata?.contextId === context?.id &&
        msg.type === 'text'
      ) {
        return `${
          msg.author.id === systemId
            ? `<|im_start|>assistant\n ${msg.text} <|im_end|>\n`
            : `<|im_end|>\n<|im_start|>user\n\n ${msg.text} <|im_end|>\n`
        }`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
  return initialChatPrompt + prompt;
};

const defaultConversationId = 'default';

const renderBubble = ({child, message}) => (
  <Bubble child={child} message={message} />
);

export default function App() {
  const [instruct, setInstruct] = useState(true);
  const [context, setContext] = useState(undefined);

  const [inferencing, setInferencing] = useState(false);
  const [messages, setMessages] = useState([]);

  const conversationIdRef = useRef(defaultConversationId);

  const addMessage = (message, batching = false) => {
    if (batching) {
      // This can avoid the message duplication in a same batch
      setMessages([message, ...messages]);
    } else {
      setMessages(msgs => [message, ...msgs]);
    }
  };

  const addSystemMessage = (text, metadata = {}) => {
    const textMessage = {
      author: system,
      createdAt: Date.now(),
      id: randId(),
      text,
      type: 'text',
      metadata: {system: true, ...metadata},
    };
    addMessage(textMessage);
  };

  const handleReleaseContext = async () => {
    if (!context) return;
    addSystemMessage('Releasing context...');
    context
      .release()
      .then(() => {
        setContext(undefined);
        addSystemMessage('Context released!');
      })
      .catch(err => {
        addSystemMessage(`Context release failed: ${err}`);
      });
  };

  const handleInitContext = async file => {
    await handleReleaseContext();
    addSystemMessage('Initializing context...');
    initLlama({
      model: file.uri,
      use_mlock: true,
      n_gpu_layers: Platform.OS === 'ios' ? 1 : 0, // > 0: enable GPU
      // embedding: true,
    })
      .then(ctx => {
        setContext(ctx);
        addSystemMessage(
          `Context initialized! \n\nGPU: ${ctx.gpu ? 'YES' : 'NO'} (${
            ctx.reasonNoGPU
          })\n\n` +
            'You can use the following commands:\n\n' +
            '- /bench: to benchmark the model\n' +
            '- /release: release the context\n' +
            '- /stop: stop the current completion\n' +
            '- /reset: reset the conversation',
        );
      })
      .catch(err => {
        addSystemMessage(`Context initialization failed: ${err.message}`);
      });
  };

  const handlePickModel = async () => {
    DocumentPicker.pick({
      type: Platform.OS === 'ios' ? 'public.data' : 'application/octet-stream',
    })
      .then(async res => {
        let [file] = res;
        if (file) {
          if (Platform.OS === 'android' && file.uri.startsWith('content://')) {
            const dir = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/models`;
            if (!(await ReactNativeBlobUtil.fs.isDir(dir)))
              await ReactNativeBlobUtil.fs.mkdir(dir);

            const filepath = `${dir}/${
              file.uri.split('/').pop() || 'model'
            }.gguf`;
            if (await ReactNativeBlobUtil.fs.exists(filepath)) {
              handleInitContext({uri: filepath});
              return;
            } else {
              await ReactNativeBlobUtil.fs.unlink(dir); // Clean up old files in models
            }
            addSystemMessage('Copying model to internal storage...');
            await ReactNativeBlobUtil.MediaCollection.copyToInternal(
              file.uri,
              filepath,
            );
            addSystemMessage('Model copied!');
            file = {uri: filepath};
          }
          handleInitContext(file);
        }
      })
      .catch(e => console.log('No file picked, error: ', e.message));
  };

  const handleSendPress = async message => {
    if (context) {
      switch (message.text) {
        case '/bench':
          addSystemMessage('Heating up the model...');
          const t0 = Date.now();
          await context.bench(8, 4, 1, 1);
          const tHeat = Date.now() - t0;
          if (tHeat > 1e4) {
            addSystemMessage('Heat up time is too long, please try again.');
            return;
          }
          addSystemMessage(`Heat up time: ${tHeat}ms`);

          addSystemMessage('Benchmarking the model...');
          const {
            modelDesc,
            modelSize,
            modelNParams,
            ppAvg,
            ppStd,
            tgAvg,
            tgStd,
          } = await context.bench(512, 128, 1, 3);

          const size = `${(modelSize / 1024.0 / 1024.0 / 1024.0).toFixed(
            2,
          )} GiB`;
          const nParams = `${(modelNParams / 1e9).toFixed(2)}B`;
          const md =
            '| model | size | params | test | t/s |\n' +
            '| --- | --- | --- | --- | --- |\n' +
            `| ${modelDesc} | ${size} | ${nParams} | pp 512 | ${ppAvg.toFixed(
              2,
            )} ± ${ppStd.toFixed(2)} |\n` +
            `| ${modelDesc} | ${size} | ${nParams} | tg 128 | ${tgAvg.toFixed(
              2,
            )} ± ${tgStd.toFixed(2)}`;
          addSystemMessage(md, {copyable: true});
          return;
        case '/release':
          await handleReleaseContext();
          return;
        case '/stop':
          if (inferencing) context.stopCompletion();
          return;
        case '/reset':
          conversationIdRef.current = randId();
          addSystemMessage('Conversation reset!');
          return;
        case '/save-session':
          context
            .saveSession(`${dirs.DocumentDir}/llama-session.bin`)
            .then(tokensSaved => {
              console.log('Session tokens saved:', tokensSaved);
              addSystemMessage(`Session saved! ${tokensSaved} tokens saved.`);
            })
            .catch(e => {
              console.log('Session save failed:', e);
              addSystemMessage(`Session save failed: ${e.message}`);
            });
          return;
        case '/load-session':
          context
            .loadSession(`${dirs.DocumentDir}/llama-session.bin`)
            .then(details => {
              console.log('Session loaded:', details);
              addSystemMessage(
                `Session loaded! ${details.tokens_loaded} tokens loaded.`,
              );
            })
            .catch(e => {
              console.log('Session load failed:', e);
              addSystemMessage(`Session load failed: ${e.message}`);
            });
          return;
      }
    }
    const textMessage = {
      author: user,
      createdAt: Date.now(),
      id: randId(),
      text: message.text,
      type: 'text',
      metadata: {
        contextId: context?.id,
        conversationId: conversationIdRef.current,
      },
    };
    addMessage(textMessage);
    setInferencing(true);

    const id = randId();
    const createdAt = Date.now();
    let prompt = generateChatPrompt(context, conversationIdRef.current, [
      textMessage,
      ...messages,
    ]);
    prompt += `\n <|im_start|>assistant \n`;

    {
      // Test tokenize
      const t0 = Date.now();
      const {tokens} = (await context?.tokenize(prompt)) || {};
      const t1 = Date.now();
      console.log(
        '<|im_start|>system\n',
        prompt,
        '\nTokenize:',
        tokens,
        `(${tokens?.length} tokens, ${t1 - t0}ms})`,
      );

      // Test embedding
      // await context?.embedding(prompt).then((result) => {
      //   console.log('Embedding:', result)
      // })

      // Test detokenize
      // await context?.detokenize(tokens).then((result) => {
      //   console.log('Detokenize:', result)
      // })
    }

    let grammar;
    {
      // Test JSON Schema -> grammar
      const schema = {
        oneOf: [
          {
            type: 'object',
            properties: {
              function: {const: 'create_event'},
              arguments: {
                type: 'object',
                properties: {
                  title: {type: 'string'},
                  date: {type: 'string'},
                  time: {type: 'string'},
                },
              },
            },
          },
          {
            type: 'object',
            properties: {
              function: {const: 'image_search'},
              arguments: {
                type: 'object',
                properties: {
                  query: {type: 'string'},
                },
              },
            },
          },
        ],
      };

      const converted = convertJsonSchemaToGrammar({
        schema,
        propOrder: {function: 0, arguments: 1},
      });
      // @ts-ignore
      if (false) console.log('Converted grammar:', converted);
      grammar = undefined;
      // Uncomment to test:
      // grammar = converted
    }

    context
      ?.completion(
        {
          prompt,
          n_predict: -1,
          temperature: 0.3,
          top_k: 40, // <= 0 to use vocab size
          top_p: 0.95, // 1.0 = disabled
          min_p: 0.05,
          repeat_penalty: 1.1,
          system_prompt: initialChatPrompt,
          //   tfs_z: 1.0, // 1.0 = disabled
          //   typical_p: 1.0, // 1.0 = disabled
          //   penalty_last_n: 0, // 0 = disable penalty, -1 = context size
          //   penalty_repeat: 1.1, // 1.0 = disabled
          //   penalty_freq: 0.0, // 0.0 = disabled
          //   penalty_present: 0.0, // 0.0 = disabled
          //   mirostat: 1, // 0/1/2
          //   // mirostat_tau: 5, // target entropy
          //   // mirostat_eta: 0.1, // learning rate
          //   penalize_nl: true, // penalize newlines
          //seed: 1234, // random seed
          //   n_batch: 512,
          //   //n_probs: 0, // Show probabilities
          //   n_ctx: 2048,
          stop: ['</s>', '<|im_end|>', 'assistant:', 'User:'],
          //   grammar,
          //   n_threads: 4,
          //   logit_bias: [[15043,1.0]],
        },
        data => {
          const {token} = data;
          setMessages(msgs => {
            const index = msgs.findIndex(msg => msg.id === id);
            if (index >= 0) {
              return msgs.map((msg, i) => {
                if (msg.type == 'text' && i === index) {
                  return {
                    ...msg,
                    text: (msg.text + token).replace(/^\s+/, ''),
                  };
                }
                return msg;
              });
            }
            return [
              {
                author: system,
                createdAt,
                id,
                text: token,
                type: 'text',
                metadata: {contextId: context?.id},
              },
              ...msgs,
            ];
          });
        },
      )
      .then(completionResult => {
        console.log('completionResult: ', completionResult);
        const timings = `${completionResult.timings.predicted_per_token_ms.toFixed()}ms per token, ${completionResult.timings.predicted_per_second.toFixed(
          2,
        )} tokens per second`;
        setMessages(msgs => {
          const index = msgs.findIndex(msg => msg.id === id);
          if (index >= 0) {
            return msgs.map((msg, i) => {
              if (msg.type == 'text' && i === index) {
                return {
                  ...msg,
                  metadata: {
                    ...msg.metadata,
                    timings,
                  },
                };
              }
              return msg;
            });
          }
          return msgs;
        });
        setInferencing(false);
      })
      .catch(e => {
        console.log('completion error: ', e);
        setInferencing(false);
        addSystemMessage(`Completion failed: ${e.message}`);
      });
  };
  if (instruct) return <Instruct />;
  return (
    <SafeAreaProvider>
      <Chat
        renderBubble={renderBubble}
        theme={darkTheme}
        messages={messages}
        onSendPress={handleSendPress}
        user={user}
        onAttachmentPress={!context ? handlePickModel : undefined}
        textInputProps={{
          editable: !!context,
          placeholder: !context
            ? 'Press the file icon to pick a model'
            : 'Type your message here',
        }}
      />
    </SafeAreaProvider>
  );
}
