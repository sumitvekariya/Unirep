import fs from 'fs'
import path from 'path'
import * as snarkjs from 'snarkjs'
import child_process from 'child_process'
import { ptauName } from './circuits.mjs'
import os from 'os'
import url from 'url'
import { copyAtomic } from './copyAtomic.mjs'
import config from '../dist/src/CircuitConfig.js'
import { Identity } from '@semaphore-protocol/identity'
import {
    IncrementalMerkleTree,
    genEpochKey,
    stringifyBigInts,
    genStateTreeLeaf,
} from '@unirep/utils'
import { poseidon1, poseidon2 } from 'poseidon-lite'
const {
    EPOCH_TREE_DEPTH,
    STATE_TREE_DEPTH,
    HISTORY_TREE_DEPTH,
    NUM_EPOCH_KEY_NONCE_PER_EPOCH,
    FIELD_COUNT,
    SUM_FIELD_COUNT,
    REPL_NONCE_BITS,
} = config.default

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))

const buildDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), 'zksnarkBuild-')
)
const outDir = path.join(__dirname, '../benchmark')
await fs.promises.mkdir(outDir, { recursive: true })
const ptauDir = path.join(__dirname, '../zksnarkBuild')

function getCircuit(config) {
    return `
        pragma circom 2.0.0; \n\n
        include "../circuits/userStateTransition.circom"; 
        \n\ncomponent main { public [ to_epoch, attester_id ] } = 
        UserStateTransition(
            ${config?.STATE_TREE_DEPTH ?? STATE_TREE_DEPTH}, 
            ${config?.EPOCH_TREE_DEPTH ?? EPOCH_TREE_DEPTH}, 
            ${config?.HISTORY_TREE_DEPTH ?? HISTORY_TREE_DEPTH}, 
            ${
                config?.NUM_EPOCH_KEY_NONCE_PER_EPOCH ??
                NUM_EPOCH_KEY_NONCE_PER_EPOCH
            }, 
            ${config?.FIELD_COUNT ?? FIELD_COUNT}, 
            ${config?.SUM_FIELD_COUNT ?? SUM_FIELD_COUNT}, 
            ${config?.REPL_NONCE_BITS ?? REPL_NONCE_BITS}
        );
        `
}

function buildCircuitName(config) {
    let name = ''
    for (const [key, value] of Object.entries(config)) {
        name += `${key}_${value}_`
    }
    return name
}

async function buildSnark(config) {
    const name = buildCircuitName(config)
    console.log('File name: ', name)
    const inputFileOut = path.join(outDir, `${name}main.circom`)
    const circuitOut = path.join(outDir, `${name}main.r1cs`)
    const circuitBuild = path.join(buildDir, `${name}main.r1cs`)
    const wasmOut = path.join(buildDir, `${name}main_js/${name}main.wasm`)
    const wasmOutFinal = path.join(outDir, `${name}.wasm`)
    const zkeyBuild = path.join(buildDir, `${name}.zkey`)
    const vkOutBuild = path.join(buildDir, `${name}.vkey.json`)
    const ptau = path.join(ptauDir, ptauName)
    const zkey = path.join(outDir, `${name}.zkey`)
    const vkOut = path.join(outDir, `${name}.vkey.json`)

    const zkeyOutFileExists = await fs.promises.stat(zkey).catch(() => false)
    const vkeyOutFileExists = await fs.promises.stat(vkOut).catch(() => false)
    const wasmOutFileExists = await fs.promises
        .stat(wasmOutFinal)
        .catch(() => false)

    const content = getCircuit(config)
    await fs.promises.writeFile(inputFileOut, content)

    // Check if the circuitOut file exists

    // Compile the .circom file
    await new Promise((rs, rj) =>
        child_process.exec(
            `circom --r1cs --wasm -o ${buildDir} ${inputFileOut}`,
            (err, stdout, stderr) => {
                if (err) rj(err)
                else rs()
            }
        )
    )
    await copyAtomic(circuitBuild, circuitOut)
    console.log(
        'Contraints:',
        (await snarkjs.r1cs.info(circuitOut)).nConstraints.toString()
    )

    await snarkjs.zKey.newZKey(circuitOut, ptau, zkeyBuild)
    const vkeyJson = await snarkjs.zKey.exportVerificationKey(zkeyBuild)
    const S = JSON.stringify(stringifyBigInts(vkeyJson), null, 1)
    await fs.promises.writeFile(vkOutBuild, S)

    if (!wasmOutFileExists) await copyAtomic(wasmOut, wasmOutFinal)
    if (!vkeyOutFileExists) await copyAtomic(vkOutBuild, vkOut)
    if (!zkeyOutFileExists) await copyAtomic(zkeyBuild, zkey)
}

const defaultProver = {
    async genProofAndPublicSignals(circuitName, inputs) {
        const circuitWasmPath = path.join(outDir, `${circuitName}.wasm`)
        const zkeyPath = path.join(outDir, `${circuitName}.zkey`)
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            inputs,
            circuitWasmPath,
            zkeyPath
        )

        return { proof, publicSignals }
    },

    async verifyProof(circuitName, publicSignals, proof) {
        const vkey = fs.readFileSync(
            path.join(outDir, `${circuitName}.vkey.json`),
            'utf8'
        )
        return snarkjs.groth16.verify(JSON.parse(vkey), publicSignals, proof)
    },
}

async function genProofAndVerify(config, circuitInputs) {
    const name = buildCircuitName(config)
    const startTime = new Date().getTime()
    const { proof, publicSignals } =
        await defaultProver.genProofAndPublicSignals(name, circuitInputs)
    const endTime = new Date().getTime()
    console.log(
        `Gen Proof time: ${endTime - startTime} ms (${Math.floor(
            (endTime - startTime) / 1000
        )} s)`
    )

    const startVerifyTime = new Date().getTime()
    const isValid = await defaultProver.verifyProof(name, publicSignals, proof)
    const endVerifyTime = new Date().getTime()
    console.log(
        `Verification time: ${endVerifyTime - startVerifyTime} ms (${Math.floor(
            (endVerifyTime - startVerifyTime) / 1000
        )} s)`
    )
    return { isValid, proof, publicSignals }
}

function randomData() {
    return [
        ...Array(SUM_FIELD_COUNT)
            .fill(0)
            .map(() => poseidon1([Math.floor(Math.random() * 199191919)])),
        ...Array(FIELD_COUNT - SUM_FIELD_COUNT)
            .fill(0)
            .map(
                () =>
                    poseidon1([Math.floor(Math.random() * 199191919)]) %
                    BigInt(2) ** BigInt(253)
            ),
    ]
}

async function genProof(config) {
    const id = new Identity()
    const fromEpoch = 1
    const toEpoch = 5
    const attesterId = BigInt(2) ** BigInt(159)
    const data = randomData()
    const stateTree = new IncrementalMerkleTree(
        config?.STATE_TREE_DEPTH ?? STATE_TREE_DEPTH
    )
    const epochTree = new IncrementalMerkleTree(
        config?.EPOCH_TREE_DEPTH ?? EPOCH_TREE_DEPTH
    )
    stateTree.insert(genStateTreeLeaf(id.secret, attesterId, fromEpoch, data))
    const stateTreeProof = stateTree.createProof(0)
    epochTree.insert(0)
    const epochTreeProof = epochTree.createProof(0)
    const epochKeys = Array(
        config?.NUM_EPOCH_KEY_NONCE_PER_EPOCH ?? NUM_EPOCH_KEY_NONCE_PER_EPOCH
    )
        .fill(null)
        .map((_, i) => genEpochKey(id.secret, BigInt(attesterId), fromEpoch, i))
    const historyTree = new IncrementalMerkleTree(
        config?.HISTORY_TREE_DEPTH ?? HISTORY_TREE_DEPTH
    )
    historyTree.insert(poseidon2([stateTree.root, epochTree.root]))
    const historyTreeProof = historyTree.createProof(0)
    await genProofAndVerify(config, {
        from_epoch: fromEpoch,
        to_epoch: toEpoch,
        identity_secret: id.secret,
        state_tree_indexes: stateTreeProof.pathIndices,
        state_tree_elements: stateTreeProof.siblings,
        history_tree_indices: historyTreeProof.pathIndices,
        history_tree_elements: historyTreeProof.siblings,
        attester_id: attesterId,
        data,
        new_data: epochKeys.map(() =>
            Array(config?.FIELD_COUNT ?? FIELD_COUNT).fill(0)
        ),
        epoch_tree_elements: epochKeys.map(() => epochTreeProof.siblings),
        epoch_tree_indices: epochKeys.map(() => epochTreeProof.pathIndices),
        epoch_tree_root: epochTree.root,
    })
}

;(async () => {
    const stateTreeDepth = 32
    const epochTreeDepth = 32
    const historyTreeDepth = 32
    const nonce = 5
    const config = {
        STATE_TREE_DEPTH: stateTreeDepth,
        EPOCH_TREE_DEPTH: epochTreeDepth,
        NUM_EPOCH_KEY_NONCE_PER_EPOCH: nonce,
        HISTORY_TREE_DEPTH: historyTreeDepth,
    }
    await buildSnark(config)
    await genProof(config)
    process.exit(0)
})()
