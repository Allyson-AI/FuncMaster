from openai import OpenAI
import json
import re
from yahoo_fin import stock_info


def parse_function_call(text):
    """Extracts and parses the function call from the given text."""
    match = re.search(r"<functioncall>(.*?)<", text, re.DOTALL)
    if not match:
        print("No valid function call found.")
        return None

    function_call_str = match.group(1).strip()
    function_call_str = function_call_str.replace("'", "")
    try:
        function_call = json.loads(function_call_str)
        return function_call
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from function call: {e}")
        return None


def get_stock_price(symbol):
    """Fetches the stock price for the given symbol."""
    try:
        price = stock_info.get_live_price(symbol)
        return price
    except Exception as e:
        print(f"Error fetching stock price for {symbol}: {e}")
        return None


# Assuming this function replaces the placeholder execute_function
def execute_function(function_call):
    if function_call["name"] == "get_stock_price":
        args_key = "arguments" if "arguments" in function_call else "parameters"

        # Check if the arguments or parameters need parsing
        if args_key in function_call:
            arguments = function_call[args_key]
            if isinstance(arguments, str):
                try:
                    # If arguments is a string, parse it as JSON
                    arguments = json.loads(arguments)
                except json.JSONDecodeError as e:
                    print(f"Error decoding JSON from function call: {e}")
                    return {}
            # At this point, arguments should be a dictionary
            symbol = arguments.get("symbol")
            if symbol:
                price = get_stock_price(symbol)
                if price is not None:
                    return {"stock_price": price}
                else:
                    print("Failed to fetch the stock price.")
            else:
                print("Symbol not found in function call arguments/parameters.")
        else:
            print(f"No '{args_key}' key found in function call.")

    return {}


# Initialize the OpenAI client
client = OpenAI(base_url="http://localhost:1234/v1", api_key="not-needed")

# Load functions from JSON file
with open("functions.json", "r") as file:
    functions = json.load(file)

# Prepare the initial message with functions loaded from JSON
messages = [
    {
        "role": "system",
        "content": f"You are a helpful assistant with access to the following functions. Use them if required- {json.dumps(functions)}",
    },
    {"role": "user", "content": "Whats the price of AMZN?"},
]


def send_message():
    # Make a request to the model
    completion = client.chat.completions.create(
        model="local-model",  # Placeholder for your actual model
        messages=messages,
        temperature=0.3,
    )
    return completion.choices[0].message.content


# Start Conversation
message = send_message()
# Process model completion for function calls
messages.append({"role": "assistant", "content": message})
function_call = parse_function_call(message)
if function_call:
    function_response = execute_function(function_call)
    if function_response:
        # Convert function response to a format suitable for appending to messages
        response_content = f"Function Response: {json.dumps(function_response)}"
        messages.append({"role": "user", "content": response_content})
        completion = send_message()
        messages.append({"role": "assistant", "content": completion})
        last_message = messages[-1]
        print(last_message['content'])
