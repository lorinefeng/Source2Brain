import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateArtifact, requireValue, hash } from './artifact.mjs';
import { expandHome } from './store.mjs';
import { readRegular } from './enhancement.mjs';
import { run } from './process.mjs';
import { atomicJson, fileDigest, verifyFile } from './reliability.mjs';

export async function transcribeArtifact(artifactPath,{from,out,runner=run,env=process.env}={}) {
  artifactPath=expandHome(artifactPath);const artifact=JSON.parse(await readRegular(artifactPath));validateArtifact(artifact);
  requireValue(artifact.content.type==='video','NOT_VIDEO','只对视频执行转写');
  const folder=await fs.realpath(path.dirname(artifactPath));
  let transcriptPath=from?expandHome(from):path.join(folder,'transcript-local.json');
  const receiptFile=path.join(folder,'transcript-receipt.json');
  const receipt=await fs.readFile(receiptFile,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const media=artifact.provenance.media_files?.find(m=>m.type==='video');
  if(!from) {
    requireValue(media?.path,'NO_VIDEO','没有成功下载的视频');
    await verifyFile(media,folder);
    if(receipt){requireValue(receipt.media_sha256===media.sha256,'MEDIA_CHANGED','转写来自不同视频');await verifyFile(receipt.transcript,folder);transcriptPath=receipt.transcript.path;}
    else {
      requireValue(env.SOURCE2BRAIN_ASR_PYTHON,'ASR_UNCONFIGURED','请按本地 ASR 配方配置 Python');
      // 完整转写先写盘、回执未登记的窗口：检查模型、正文和来源哈希后可接管。
      const existing=await fs.lstat(transcriptPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
      if(!existing) {
        const args=[fileURLToPath(new URL('../scripts/transcribe-local.py',import.meta.url)),media.path,'--output',transcriptPath];
        if(env.SOURCE2BRAIN_ASR_MODEL_ROOT)args.push('--model-root',expandHome(env.SOURCE2BRAIN_ASR_MODEL_ROOT));
        await runner(expandHome(env.SOURCE2BRAIN_ASR_PYTHON),args,{timeout:1_200_000});
      }
    }
  }
  const transcript=JSON.parse(await readRegular(transcriptPath));
  requireValue(typeof transcript.text==='string' && transcript.text.trim() && typeof transcript.model==='string' && transcript.model.trim(),'EMPTY_TRANSCRIPT','转写没有可读正文与模型来源');
  if(!from) {
    requireValue(transcript.media_sha256===media.sha256,'MEDIA_CHANGED','转写检查点缺少匹配的视频哈希');
    await atomicJson(receiptFile,{media_sha256:media.sha256,transcript:await fileDigest(transcriptPath,folder)});
  }
  artifact.content.transcript=transcript.text;artifact.extraction.transcript='complete';
  artifact.extraction.limitations=['语音识别未经逐字校对；只覆盖音频，不包含视频画面'];
  artifact.provenance.steps.push(`本地 ASR：${transcript.model}`);artifact.provenance.transcript_file=transcriptPath;
  const output=expandHome(out||path.join(folder,'artifact-transcribed.json'));
  const existing=await fs.readFile(output,'utf8').then(JSON.parse).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(existing)requireValue(hash(JSON.stringify(existing))===hash(JSON.stringify(artifact)),'SOURCE_CHANGED','已有转写 artifact 不同，不覆盖');
  else await atomicJson(output,artifact);
  return{status:'transcribed_needs_summary',artifact:output,characters:transcript.text.length};
}
