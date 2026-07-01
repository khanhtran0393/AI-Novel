const key = 'AIzaSyAaSas8uU2gjkVhWmd1WJ8kp0lcRBRT0lM';

async function run() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    console.log(`Status: ${res.status}`);
    
    const imagenModels = data.models.filter(m => m.name.includes('imagen') || m.name.includes('veo'));
    console.log('\n--- Imagen and Veo Models ---');
    console.log(JSON.stringify(imagenModels, null, 2));
  } catch (err) {
    console.log('Error:', err.message);
  }
}

run();
