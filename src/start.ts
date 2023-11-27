import { Interface } from "ethers/lib/utils";
import { HttpsProxyAgent } from "https-proxy-agent";
import { seqFunctionAbi } from "./abi";
import fs from 'fs';
import { decodeL2Msgs, decompressAndDecode, getAllL2Msgs, processRawData } from "./utils";
import { Transaction } from "ethers";

var fetch = require('node-fetch');
let rs: RuntimeState
type Result = {
    txhash: string
    v: number
    type: number
}

type RuntimeState = {
    startblock: number
    endblock: number
    page: number
    txCount: number
}

const callEtherscan = async (startblock: number, endblock: number, page: number) => {
    const results = await fetch(`https://api.etherscan.io/api?module=account&action=txlist&address=0xC1b634853Cb333D3aD8663715b08f41A3Aec47cc&startblock=${startblock}&endblock=${endblock}&page=${page}&offset=20&sort=asc&apikey=BMVWB33ZWUS3CJYFDPIIZERVEXZJ4Y8WH9`);
    const s = await results.text();
    const json = JSON.parse(s);
    console.log(json.result.length);
    return json.result;
}


const startSearch = async (startblock: number, endblock: number) => {
    
    if (fs.existsSync('./resumeState.json')) {
        console.log("found resume state");
        const stateRaw = fs.readFileSync('./config/resumeState.json', 'utf-8');
        rs = JSON.parse(stateRaw);
    } else {
        rs = {
            startblock: startblock,
            endblock: endblock,
            page: 1,
            txCount: 0
        }
    }
    const res: Result[] = []
    // let page = rs.page
    do {
        let results;
        try {
            console.log("processing page: " + rs.page)
            results = await callEtherscan(startblock, endblock, rs.page);
        } catch(err) {
            const res_str = JSON.stringify(res);
            fs.writeFileSync("./resumeState.json", JSON.stringify(rs));
            fs.writeFileSync("./out", res_str);
            console.log("error happened...");
            throw err;
        }
        res.push(...processResults(results))
        if(results.length === 0) {
            console.log(results);
            break
        }
        rs.page++;
    } while (true)
    const res_str = JSON.stringify(res);
    fs.writeFileSync("./out", res_str);
}

const processResults = (results: any): Result[] => {
    const res: Result[] = [];
    for (let i = 0; i < results.length; i++) {
        if(results[i].functionName !== "addSequencerL2BatchFromOrigin(uint256 sequenceNumber,bytes data,uint256 afterDelayedMessagesRead,address gasRefunder,uint256 prevMessageCount,uint256 newMessageCount)") {
            continue;
        }
        const contractInterface = new Interface(seqFunctionAbi);
        const funcData = contractInterface.decodeFunctionData('addSequencerL2BatchFromOrigin', results[i].input);
        const seqData = funcData['data'].substring(2); //remove '0x'
        const rawData = Uint8Array.from(Buffer.from(seqData, 'hex'));
        const compressedData = processRawData(rawData);
        const l2segments = decompressAndDecode(compressedData);
        const l2Msgs = getAllL2Msgs(l2segments);
        for (let i = 0; i < l2Msgs.length; i++) {
            const txs = decodeL2Msgs(l2Msgs[i]);
            res.push(...processTxs(txs));
        }
    }

    return res;
}

const processTxs = (txs: Transaction[]) => {
    const res: Result[] = [];
    for(let a = 0; a < txs.length; a++) {
        rs.txCount++
        const v = txs[a].v || 0;
        if(!txs[a].type || txs[a].type === 0) {
            if(v === 27 || v === 28 || v === 1 || v === 0) {
                const result: Result = {
                    txhash: txs[a].hash!,
                    v: txs[a].v!,
                    type: txs[a].type!
                }
                res.push(result);
            }
        }
    }
    return res;
}

startSearch(18654109, 18661209);