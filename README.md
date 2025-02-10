# customAI
This provides an extension to your VS code for it to run AI models (like deepseek) via ollama in your VS Code, please read the README


# How to's:
1. Install Ollama @ [Here](https://ollama.com/download)
```bash
npm install
ollama run deepseek-r1:8b #<-- You can change this depending on your machine
```
2. If you change the ollama AI model, change the code on extension.ts (line 156) to your AI model(s)

# Reference
1. [Ollama AI Models](https://ollama.com/library/deepseek-r1)