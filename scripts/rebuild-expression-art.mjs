import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Actual expression edits come from imagegen. This preserves the approved body/hands.
const manifest = JSON.parse(await readFile("art/expression-edits/prompts.json", "utf8"));
const width = 1024, height = 1536;
const face = [[362,190],[375,166],[402,156],[437,140],[472,140],[495,153],[508,180],[511,207],[500,231],[473,255],[452,270],[424,265],[397,249],[377,228],[365,210]];
const eyes = [
  [[362,195],[371,183],[396,174],[415,182],[420,200],[404,219],[377,225],[361,211]],
  [[435,164],[443,148],[469,139],[493,146],[503,158],[495,182],[469,192],[443,186]],
];
function coverage(x, y, polygon) {
  let inside = false, distance = Infinity;
  for (let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const [ax,ay]=polygon[j],[bx,by]=polygon[i];
    if((ay>y)!==(by>y)&&x<(bx-ax)*(y-ay)/(by-ay)+ax)inside=!inside;
    const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy)));
    distance=Math.min(distance,Math.hypot(x-ax-t*dx,y-ay-t*dy));
  }
  const value=inside?Math.min(1,distance/4):0;
  return value*value*(3-2*value);
}
await mkdir("art/masters/character/v3", {recursive:true});
await mkdir("public/art/character/v3", {recursive:true});
await mkdir("docs/screenshots", {recursive:true});
const report=[];
for(const asset of manifest.assets) {
  const original=await sharp(`art/masters/character/v2/${asset.base}.png`).ensureAlpha().raw().toBuffer();
  const normalized=await sharp(`art/expression-edits/${asset.generated}`).resize(1024,1024).png().toBuffer();
  const patch=await sharp(normalized).extract({left:72,top:172,width:880,height:680}).resize(220,170).ensureAlpha().raw().toBuffer();
  const output=Buffer.from(original), masks=asset.id.startsWith("thinking-")?eyes:[face];
  const mask=new Float32Array(width*height);
  for(let y=140;y<310;y++)for(let x=340;x<560;x++){
    const pixel=y*width+x,offset=pixel*4,source=((y-140)*220+x-340)*4;
    const value=Math.max(...masks.map(polygon=>coverage(x+.5,y+.5,polygon)))*patch[source+3]/255;
    mask[pixel]=value;if(!value)continue;
    for(let channel=0;channel<3;channel++)output[offset+channel]=Math.round(original[offset+channel]*(1-value)+patch[source+channel]*value);
    // Deliberately keep the original alpha byte, including every transparent edge.
  }
  let changed=0,outside=0,alphaChanged=0;
  for(let pixel=0;pixel<width*height;pixel++){
    const offset=pixel*4;
    if(output[offset+3]!==original[offset+3])alphaChanged++;
    if(output.subarray(offset,offset+4).compare(original.subarray(offset,offset+4))){changed++;if(!mask[pixel])outside++;}
  }
  if(outside||alphaChanged)throw new Error(`${asset.id}: preservation check failed`);
  const master=`art/masters/character/v3/${asset.id}.png`;
  await sharp(output,{raw:{width,height,channels:4}}).png().toFile(master);
  await sharp(master).webp({quality:93,alphaQuality:100,effort:5}).toFile(`public/art/character/v3/${asset.id}.webp`);
  report.push({id:asset.id,base:asset.base,width,height,changedPixels:changed,changedOutsideFace:outside,changedAlphaBytes:alphaChanged});
}
await writeFile("art/expression-edits/pixel-audit.json",JSON.stringify({faceMask:face,eyeMasks:eyes,featherPixels:4,report},null,2)+"\n");
const labels={shy:"害羞 · shy",eager:"期待 · eager",pout:"鼓腮 · pout",sleepy:"困困 · sleepy",thinking:"原有思考", "thinking-focus":"认真查单", "thinking-ponder":"侧目回想", "thinking-blink":"闭眼眨眼"};
const ordered=["shy","eager","pout","sleepy","thinking","thinking-focus","thinking-ponder","thinking-blink"].filter(id=>id==="thinking"||manifest.assets.some(asset=>asset.id===id));
const tiles=[];
for(const [index,id]of ordered.entries()){
  const column=index%4,row=Math.floor(index/4),path=id==="thinking"?"art/masters/character/v2/thinking.png":`art/masters/character/v3/${id}.png`;
  const input=await sharp(path).extract({left:340,top:140,width:220,height:160}).resize(440,320).flatten({background:"#fff8ee"}).png().toBuffer();
  tiles.push({input,left:column*460+10,top:row*370+45});
  const label=Buffer.from(`<svg width="460" height="40"><text x="14" y="29" font-family="Microsoft YaHei,Arial,sans-serif" font-size="22" fill="#29465e">${labels[id]}</text></svg>`);
  tiles.push({input:label,left:column*460,top:row*370});
}
await sharp({create:{width:1840,height:Math.ceil(ordered.length/4)*370,channels:4,background:"#fff8ee"}}).composite(tiles).jpeg({quality:93}).toFile("docs/screenshots/expression-preview.jpg");
console.log(JSON.stringify(report));
