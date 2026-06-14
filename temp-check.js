const path = require('path');
const fs = require('fs');
const envPath = path.join(process.cwd(), 'api', '.env');
const content = fs.readFileSync(envPath, 'utf8');
const match = content.match(/^DATA_PATH\s*=\s*"([^"]+)"/m);
console.log('Match:', match ? match[1] : 'NO MATCH');
console.log('Normalized:', match ? path.normalize(match[1]) : 'N/A');
console.log('isAbsolute:', match ? path.isAbsolute(match[1]) : 'N/A');
