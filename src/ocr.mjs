import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
const exec = promisify(execFile);
export async function recognizeText(path) {
  const {stdout} = await exec(resolve('.scratch/sap-ocr'),[resolve(path)],{maxBuffer:8*1024*1024});
  return JSON.parse(stdout.trim()).text;
}
