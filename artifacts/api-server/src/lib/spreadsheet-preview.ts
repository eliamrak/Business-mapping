import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
type Preview = {
  sheets: { name: string; rows: string[][] }[];
  limited: boolean;
};

// Untrusted workbook decompression runs outside the API heap with a deadline.
export function spreadsheetPreview(data: string): Promise<Preview> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const {parentPort,workerData}=require('node:worker_threads');
      const ExcelJS=require(workerData.module);
      (async()=>{
        const book=new ExcelJS.Workbook();
        await book.xlsx.load(Buffer.from(workerData.data,'base64'));
        parentPort.postMessage({
          sheets:book.worksheets.slice(0,20).map(sheet=>({name:sheet.name,rows:Array.from({length:Math.min(sheet.rowCount,1001)},(_,r)=>Array.from({length:Math.min(sheet.columnCount,80)},(_,c)=>{const cell=sheet.getRow(r+1).getCell(c+1);return cell.type===ExcelJS.ValueType.Date?cell.value.toISOString().slice(0,10):String(cell.text).slice(0,10000);}))})),
          limited:book.worksheets.length>20 || book.worksheets.some(s=>s.rowCount>1001||s.columnCount>80)
        });
      })().catch(error=>{throw error;});
    `,
      {
        eval: true,
        workerData: { data, module: require.resolve("exceljs") },
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 32,
          stackSizeMb: 4,
        },
      },
    );
    let complete = false;
    const timer = setTimeout(() => {
      complete = true;
      void worker.terminate();
      reject(new Error("Spreadsheet preview exceeded the time limit."));
    }, 12000);
    worker.once("message", (value: Preview) => {
      complete = true;
      clearTimeout(timer);
      resolve(value);
      void worker.terminate();
    });
    worker.once("error", (error) => {
      complete = true;
      clearTimeout(timer);
      reject(error);
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      if (!complete)
        reject(new Error("Spreadsheet preview stopped before completion."));
    });
  });
}
