const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" };
export async function onRequestOptions(){return new Response(null,{status:204,headers:{...CORS,"Access-Control-Allow-Methods":"GET, POST, OPTIONS"}})}
export async function onRequest(){return new Response(JSON.stringify({error:"route_retired",canonical:"/api/bar/x402/analyze-video-audio-and-pdfs"}),{status:410,headers:CORS})}
