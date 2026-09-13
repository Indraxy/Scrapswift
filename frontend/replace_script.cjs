const fs = require('fs');
const files = [
  'src/pages/collector/Lots.jsx',
  'src/lib/supabaseDb.js',
  'src/lib/supabase.js',
  'src/App.jsx',
  'index.html',
  'public/manifest.webmanifest',
  'package.json'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/KabaadE/g, 'Scrapswift');
  
  if (file === 'package.json') {
    content = content.replace(/"name":\s*"[^"]+"/, '"name": "Scrapswift"');
  }
  
  fs.writeFileSync(file, content);
  console.log('Updated ' + file);
}
