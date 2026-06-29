const fal = require('@fal-ai/serverless-client');

fal.config({ credentials: '4ddf2f8e-d444-4a7b-9c82-25a9ad7bfb3e:ff741296d01358358515d580d9774ff3' });

async function main() {
  try {
    const input = {
      prompt: "A beautiful marketing scene",
      image_url: "https://github.com/github.png",
      // Removed aspect_ratio and resolution
      duration: "5",
      camera_fixed: false,
      seed: 12345,
      enable_safety_checker: true
    };

    console.log("Calling seedance model...");
    const res = await fal.subscribe("fal-ai/bytedance/seedance/v1/pro/image-to-video", { input });
    console.log("Success:", JSON.stringify(res, null, 2));
  } catch (error) {
    console.error("Error generating:", error.message);
    if (error.response) {
      console.error("Response data:", error.response.data);
    }
    console.error("Full Error JSON:", JSON.stringify(error, null, 2));
  }
}

main();
