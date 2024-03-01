import React, {useState, useRef} from 'react';
import {Platform, Text} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import DocumentPicker from 'react-native-document-picker';
import {Chat, darkTheme} from '@flyerhq/react-native-chat-ui';
import ReactNativeBlobUtil from 'react-native-blob-util';
import {initLlama, LlamaContext, convertJsonSchemaToGrammar} from 'llama.rn';
import {Bubble} from './Bubble';

const {dirs} = ReactNativeBlobUtil.fs;

const randId = () => Math.random().toString(36).substr(2, 9);

const user = {id: 'y9d7f8pgn'};

const systemId = 'h3o3lc5xj';
const system = {id: systemId};

const functionSystem = `###
Instruction:

You are a helpful assistant with access to the following functions. Use them if required - [{"name": "stock_price", "description": "Get the current stock price", "parameters": {"type": "object", "properties": {"symbol": {"type": "string", "description": "The stock symbol, e.g. AAPL"}}, "required": ["symbol"]}}, {"name": "create_poll", "description": "Create a new poll for gathering opinions", "parameters": {"type": "object", "properties": {"question": {"type": "string", "description": "The question for the poll"}, "options": {"type": "array", "items": {"type": "string"}, "description": "The options for the poll"}}, "required": ["question", "options"]}}] 
Respond In JSON {message: '', function_call: None}
`;
const responseSystemPrompt = `###
Instruction:

Here is the response from the function
`;

const generateChatPrompt = (systemPrompt, context, conversationId, messages) => {
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
            ? `### Response\n ${msg.text}\n`
            : `### Input\n\n ${msg.text} \n`
        }`;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
  return systemPrompt + prompt;
};

const defaultConversationId = 'default';

const renderBubble = ({child, message}) => (
  <Bubble child={child} message={message} />
);

const fetchStockPrice = async symbol => {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?&interval=1d`;

  try {
    const response = await fetch(url, {
      method: 'GET', // HTTP method
      headers: {
        'User-Agent':
          'YMozilla/5.0 (Macintosh; Intel Mac OS X 10_10_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/39.0.2171.95 Safari/537.36', // Replace 'YourAppName/1.0' with your actual app name and version
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching stock data: ${response.statusText}`);
    }

    const data = await response.json();

    // Accessing the regularMarketPrice from the data
    const regularMarketPrice = data.chart.result[0].meta.regularMarketPrice;
   
    return `Regular Market Price for ${symbol}: $${regularMarketPrice}`;

  } catch (error) {
    console.error('Failed to fetch stock price:', error);
  }
};

function correctNestedJSON(inputString) {
  // Pattern to match "parameters" or "arguments" followed by a colon, then a JSON string
  const pattern = /"(parameters|arguments)":\s*"\{([^}]+)\}"/g;

  // Replace function to correctly escape nested JSON strings
  const replaceFn = (match, key, nestedJson) => {
    // Escape double quotes inside the nested JSON string
    const escapedNestedJson = nestedJson.replace(/"/g, '\\"');
    // Reconstruct the string with the escaped nested JSON
    return `"${key}": "{${escapedNestedJson}}"`;
  };

  // Apply the replacement to the input string
  return inputString.replace(pattern, replaceFn);
}

async function extractFunctionCall(inputString) {
  const regex = /(function_call.*)/;
  const match = inputString.match(regex);

  if (match) {
    const functionCallAndAfter = match[1]; // The captured group which is everything after "function_call"
    let cleanedStr = functionCallAndAfter
      .trim() // Remove leading/trailing whitespace
      .replace(/(?:\\[rn]|[\r\n]+)+/g, ' ') // Replace new lines and carriage returns with a space
      .replace(/'/g, '"') // Naive replace single quotes with double quotes
      .replace(/[\r\n]+/g, ' ') // Remove newlines
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(
        /:\s*"([^"]*)"/g,
        (match, p1) => `: "${p1.replace(/:/g, '@colon@')}"`,
      ) // Protect colons inside strings
      .replace(/([{,]\s*)?([a-zA-Z0-9_]+)\s*:/g, '$1"$2":') // Add quotes around unquoted keys
      .replace(/@colon@/g, ':'); // Restore colons inside strings

    try {
      const trimmedString = cleanedStr.substring(cleanedStr.indexOf('{'));
      let correctedString = correctNestedJSON(trimmedString);
      const regex = /"name":\s*"([^"]+)"/;
      const match = correctedString.match(regex);
      console.log('function:', match[1]);
      if (match[1] === 'stock_price') {
        const regexPattern = /"symbol":\s*"(\{(?:(?>[^{}"'\/]+)|(?>"(?:(?>[^\\"]+)|\\.)*")|(?>'(?:(?>[^\\']+)|\\.)*')|(?>\/\/.*\n)|(?>\/\*.*?\*\/)|(?-1))*\})/;        
        const symbol = correctedString.match(regexPattern);
        console.log('symbol:', symbol[1]);
        let data = await fetchStockPrice(symbol[1]);
        return data 
      }
    } catch (error) {
      console.error('Error parsing cleaned string:', error);
    }
  }


}

export default function Instruct() {
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
    let prompt = generateChatPrompt(functionSystem, context, conversationIdRef.current, [
      textMessage,
      ...messages,
    ]);
    prompt += `\n ### Response: \n`;

    {
      // Test tokenize
      const t0 = Date.now();
      const {tokens} = (await context?.tokenize(prompt)) || {};
      const t1 = Date.now();
      console.log(
        '### Instruction\n',
        prompt,
        '\nTokenize:',
        tokens,
        `(${tokens?.length} tokens, ${t1 - t0}ms})`,
      );
    }
    let streamMsg = '';
    let func = false;
    context
      ?.completion(
        {
          prompt,
          n_predict: 256,
          temperature: 0.7,
          top_k: 40, // <= 0 to use vocab size
          top_p: 0.95, // 1.0 = disabled
          min_p: 0.05,
          repeat_penalty: 1.1,
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
          n_ctx: 2048,
          stop: ['</s>', '###', '<|im_end|>', 'assistant:', 'User:'],
          //   grammar,
          //   n_threads: 4,
          //   logit_bias: [[15043,1.0]],
        },
        data => {
          const {token} = data;
          streamMsg += token;

          if (streamMsg.includes('function_call')) {
            func = true;
          }
          func = false;
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
      .then(async completionResult => {
        console.log('completionResult: ', completionResult);
        const timings = `${completionResult.timings.predicted_per_token_ms.toFixed()}ms per token, ${completionResult.timings.predicted_per_second.toFixed(
          2,
        )} tokens per second`;
        //console.log(streamMsg);
        // let funcRes = await extractFunctionCall(streamMsg);
        // console.log(funcRes)
        if (!func) {
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
        }
        setInferencing(false);
      })
      .catch(e => {
        console.log('completion error: ', e);
        setInferencing(false);
        addSystemMessage(`Completion failed: ${e.message}`);
      });
  };

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
