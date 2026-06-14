from ollama import chat

response = chat(
    model='Qwen3-Coder:30b',
    messages=[{'role': 'user', 'content': 'Hello!'}],
)
print(response.message.content)