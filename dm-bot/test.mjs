import { readFileSync } from "fs";
const CONFIG = JSON.parse(readFileSync(new URL("./config.json", import.meta.url)));
const src = readFileSync(new URL("./worker.js", import.meta.url), "utf8")
  .replace('import CONFIG from "./config.json";', "")
  .replace(/export default \{[\s\S]*?\n\};\n/, "");
const m = await import("data:text/javascript," + encodeURIComponent("const CONFIG=" + JSON.stringify(CONFIG) + ";" + src));
const cases = [["מסכה","mask"],[" מסכה! ","mask"],["מסכה 🤍","mask"],["מייק אפ","mask"],["מאצ׳ה","matcha"],["מאצ'ה","matcha"],
 ["אני רוצה מסכה",null],["מסכה בבקשה",null],["לימון",null],["",null],["רטינול.","retinol"],["בננה","banana"]];
let bad=0; for (const [t,e] of cases){const g=m.matchKeyword(t); if(g!==e){bad++;console.log("FAIL",JSON.stringify(t),g,e);}}
console.log(bad? bad+" failed":"all "+cases.length+" passed");
