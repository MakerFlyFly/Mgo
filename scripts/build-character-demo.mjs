import sharp from "sharp";

// An explicitly labelled asset preview; the UI itself uses the tested random timer.
const sequence = [
  ["shy",1400,"害羞"],["eager",1400,"期待"],["pout",1400,"鼓腮"],["sleepy",1400,"困困"],
  ["thinking",3500,"思考"],["thinking-blink",120,"思考"],["thinking",2380,"思考"],
  ["thinking-focus",1000,"认真查单"],["thinking-blink",120,"认真查单"],["thinking-focus",3580,"认真查单"],
  ["thinking-blink",120,"认真查单"],["thinking-focus",1180,"认真查单"],
  ["thinking-ponder",2500,"侧目回想"],["thinking-blink",120,"侧目回想"],["thinking-ponder",2880,"侧目回想"],
];
const frames=[];
for(const [id,,label]of sequence){
  const source=id==="thinking"?"art/masters/character/v2/thinking.png":`art/masters/character/v3/${id}.png`;
  const face=await sharp(source).extract({left:330,top:125,width:240,height:190}).resize(480,380).flatten({background:"#fff8ee"}).png().toBuffer();
  const title=Buffer.from(`<svg width="500" height="60"><rect width="500" height="60" fill="#fff8ee"/><text x="16" y="24" font-family="Microsoft YaHei,Arial,sans-serif" font-size="15" fill="#819097">Mgo · 表情素材预览</text><text x="16" y="49" font-family="Microsoft YaHei,Arial,sans-serif" font-size="20" fill="#29465e">${label}</text></svg>`);
  frames.push(await sharp({create:{width:500,height:440,channels:4,background:"#fff8ee"}}).composite([{input:title,left:0,top:0},{input:face,left:10,top:60}]).png().toBuffer());
}
await sharp(frames,{animated:true,join:{animated:true}}).gif({loop:0,delay:sequence.map(row=>row[1]),effort:5,colours:192}).toFile("docs/character-demo.gif");
console.log(JSON.stringify({file:"docs/character-demo.gif",frames:sequence.length,description:"Labelled expression asset preview, not a network latency recording"}));
