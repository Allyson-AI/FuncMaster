# FuncMaster Usage Guide

This guide will walk you through the steps to get started with our React Native example app, how to run our function calling models locally, and how to utilize the LM Studio presets for testing and development.

**[Built by Allyson AI](https://allyson.ai)**

**[FuncMaster Docs](https://docs.allyson.ai/models/func-master)**

## RNExample (Run LLMs Locally on iPhone)

The `RNExample` folder contains a React Native app designed to demonstrate the capabilities of FuncMaster. To get it up and running, follow these steps:

### Setup

1. **Clone the Repo**: Ensure you have the FuncMaster repository cloned to your local machine.
2. **Navigate to RNExample**: Change directory into the `RNExample`

   ```bash
   cd RNExample
   ```
3. **Install Dependencies**: Run the following commands to install the necessary npm packages and Cocoapods dependencies.

   ```bash
   npm install
   npx pod-install
   ```
4. **Open Xcode**: To run the app on an iOS device, you'll need to open the project in Xcode and sign the application with your developer account. This step is crucial for deploying the app to your device.

### Running the App

1. **Download the Model**: Ensure you download the desired model version from Hugging Face, specifically the `GGUF` variant.
2. **Configure the App**: Depending on the model you're using (Instruct vs. Chat), adjust the `instruct` variable in `App.jsx`.
   - For Instruct: Set `instruct` to `true`.
   - For Chat: Ensure `instruct` is set to `false`.
3. **Launch the App**: Use Xcode to build and run the app on your device. To test the model, tap the file button within the app interface.
 ```bash
   npm start
   ```

### Model and Accuracy

- The app currently supports two query types: `Q_2` and `Q_4_K_M`. For better accuracy, it's recommended to use `Q_4_K_M`, although it's still under improvement.

## Python Scripts and LM Studio

The repository also includes `infer.py`, a script for running inference through the LM Studio server.

### LM Studio Server

1. **LM Studio Presets**: Load the presets from the `LM Studio` folder corresponding to your model version. The chat model preset is recommended for best performance.
2. **Start the server**: Start the server on LM Studio.
3. **Running the Script**: Execute `infer.py` to send a request to the LM Studio server. This script is set up for testing purposes, such as retrieving the stock price of AMZN using the `yahoo_fin` package for the function call `get_stock_price`.
```python
python infer.py
```
Example Response: 
```
The price of AMZN is currently $178.12. <|endoftext|>
```

### LM Studio Presets

The presets provided in the `LM Studio` folder are designed to simplify the setup process for different model versions. Ensure you select the appropriate preset for your testing scenario.

## Conclusion

This guide should help you get started with the FuncMaster project, from running the React Native example app to utilizing the Python scripts with LM Studio presets. We're excited to see how you use FuncMaster to build innovative AI-powered applications that run locally. For more information and updates, keep an eye on our GitHub repository.

## TO-DO
- Make function calling work in chat and not just call the function.