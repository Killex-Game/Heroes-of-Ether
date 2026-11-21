'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../../games/heroes-of-ether/config');
try{fs.copyFileSync(path.join(root,'owner-admin.example.json'),path.join(root,'owner-admin.json'),fs.constants.COPYFILE_EXCL);console.log('Created private local owner configuration.');}
catch(e){if(e.code!=='EEXIST')throw e;console.log('Existing private configuration preserved.');}
