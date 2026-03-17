
async function generateImageFromPrompt(prompt) {
  return {
    type: "image",
    url: "https://dummyimage.com/1024x1024"
  };
}
module.exports = { generateImageFromPrompt };
