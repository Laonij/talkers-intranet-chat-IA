
function shouldForceImageGeneration(message, lastIntent) {
  const text = message.toLowerCase();
  const confirmations = ["pode gerar","gera","então faça","faz a imagem","crie a imagem","sim","ok"];
  return confirmations.some(c => text.includes(c)) && lastIntent === "image";
}

async function handleRequest(userMessage, lastArtifact) {
  if (shouldForceImageGeneration(userMessage, lastArtifact?.type)) {
    return await generateImageFromPrompt(lastArtifact.prompt);
  }
}
module.exports = { handleRequest };
