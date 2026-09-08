const fs = require('fs');
let content = fs.readFileSync('src/i18n/index.jsx', 'utf8');

const bnContentFile = fs.readFileSync('write_bn.cjs', 'utf8');
const startBn = bnContentFile.indexOf('const bn = {');
const endBn = bnContentFile.indexOf('};', startBn) + 2;
const bnContent = bnContentFile.substring(startBn, endBn);

const startStr = 'const mr = {';
const endStr = '  notFound: \'या क्रमांकाचा लॉट सापडला नाही.\'\n}';

const startIndex = content.indexOf(startStr);
const endIndex = content.indexOf(endStr) + endStr.length;

if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
  content = content.substring(0, startIndex) + bnContent + content.substring(endIndex);
  fs.writeFileSync('src/i18n/index.jsx', content);
  console.log('Success! Replaced mr with bn.');
} else {
  console.log('Failed to find exact block. startIndex:', startIndex, 'endIndex:', endIndex);
}
