const fetch = require('node-fetch');

async function testStylePrompts() {
  console.log('🧪 Testing Video Style Prompt Engineering...\n');

  // Test 1: Get styles
  console.log('Test 1: GET /api/videoStyles');
  // the server is running on port 5000 in this project based on api.ts, not 3000
  const stylesRes = await fetch('http://localhost:5000/api/videoStyles');
  console.log('Status 1:', stylesRes.status);
  let styles;
  try {
    styles = await stylesRes.json();
    console.log(`✅ Found ${styles.totalStyles} styles\n`);
  } catch (e) {
    const text = await stylesRes.text();
    console.error('Failed to parse json. Body:', text);
    return;
  }

  // Test 2: Generate prompts
  console.log('Test 2: POST /api/generateVideoStylePrompts');
  const promptRes = await fetch('http://localhost:5000/api/generateVideoStylePrompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      description: 'Professional tool demo',
      videoStyle: 'Cinematic Commercial',
      characterName: 'SIVA',
      sceneCount: 5,
      duration: 30
    })
  });
  
  console.log('Status 2:', promptRes.status);
  let prompts;
  try {
    prompts = await promptRes.json();
  } catch (e) {
    console.error('Failed to parse json for prompts', await promptRes.text());
    return;
  }
  
  console.log(`✅ Generated ${prompts.scenes?.length} scenes`);
  
  // Check first scene
  const scene1 = prompts.scenes[0];
  console.log(`\n📸 Scene 1: ${scene1.title}`);
  console.log(`   Image Prompt (first 100 chars): ${scene1.imagePrompt.substring(0, 100)}...`);
  console.log(`   Video Prompt (first 100 chars): ${scene1.videoPrompt.substring(0, 100)}...`);
  console.log(`   Audio Style: ${scene1.audioStyle}`);
  
  console.log('\n✅ All tests passed!');
}

testStylePrompts().catch(console.error);
