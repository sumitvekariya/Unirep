import fetch from 'node-fetch'
import { IncrementalMerkleTree } from '@unirep/utils'
import { ethers } from 'ethers'
import { getUnirepContract } from '@unirep/contracts'
import { toDecString } from './Synchronizer'
import { DB, TransactionDB } from 'anondb'

export class SubgraphSynchronizer {
    private _url
    private _attesterId: bigint[] = []
    private _syncAll = false
    private _settings: any
    private _provider: ethers.providers.Provider
    private _unirepAddress: string = ''
    private _unirepContract: ethers.Contract | undefined
    protected defaultStateTreeLeaf: bigint = BigInt(0)
    protected defaultEpochTreeLeaf: bigint = BigInt(0)
    public queryCount = 1000

    constructor(config: {
        provider: ethers.providers.Provider
        // unirepAddress: string,
        url: string
        attesterId?: bigint | bigint[]
    }) {
        const { url, attesterId, provider } = config
        this._url = url
        this._provider = provider
        if (Array.isArray(attesterId)) {
            // multiple attesters
            this._attesterId = attesterId.map((a) => BigInt(a))
        } else if (!!attesterId) {
            // single attester
            this._attesterId = [BigInt(attesterId)]
        } else if (!attesterId) {
            this._syncAll = true
        }
        this._settings = {
            stateTreeDepth: 0,
            epochTreeDepth: 0,
            historyTreeDepth: 0,
            numEpochKeyNoncePerEpoch: 0,
            epochLength: 0,
            fieldCount: 0,
            sumFieldCount: 0,
            replNonceBits: 0,
            replFieldBits: 0,
        }
    }

    get settings() {
        return this._settings
    }

    get provider() {
        return this._provider
    }

    get url() {
        return this._url
    }

    get attesterId() {
        if (this._attesterId.length === 0) return BigInt(0)
        return this._attesterId[0]
    }

    get unirepContract() {
        return this._unirepContract
    }

    get unirepAddress() {
        return this._unirepAddress
    }

    attesterQuery(attesterId: string | undefined) {
        return attesterId ? `where: {attesterId: "${attesterId}"}` : ''
    }

    attesterExist(attesterId: string | bigint) {
        return this._attesterId.indexOf(BigInt(attesterId)) !== -1
    }

    checkAttesterId(attesterId: string | bigint) {
        if (this._attesterId.length === 0) {
            throw new Error(
                `@unirep/core:Synchronizer: no attester ID is synchronized`
            )
        }
        if (!this.attesterExist(attesterId)) {
            throw new Error(
                `@unirep/core:Synchronizer: attester ID ${attesterId.toString()} is not synchronized`
            )
        }
    }

    async retry(fn: any, maxRetry = 10) {
        let retryCount = 0
        let backoff = 1000
        for (;;) {
            try {
                return await fn()
            } catch (err) {
                if (++retryCount > maxRetry) throw err
                console.log(err)
                backoff *= 2
                await new Promise((r) => setTimeout(r, backoff))
            }
        }
    }

    async setup() {
        if (this.unirepContract) return
        const query = `
        {
            attesters (
                where: {
                    attesterId: "0"
                }
            ) {
                transactionHash
            }
        }
        `

        const receipt = await this.retry(async () => {
            const res = await this.request(query)
            const transactionHash = res.data.attesters[0].transactionHash
            return this.provider.getTransactionReceipt(transactionHash)
        })

        this._unirepAddress = receipt.logs[0].address
        this._unirepContract = getUnirepContract(
            this._unirepAddress,
            this._provider
        )
        if (this._unirepContract) {
            const config = await this._unirepContract.config()
            this._settings.stateTreeDepth = config.stateTreeDepth
            this._settings.epochTreeDepth = config.epochTreeDepth
            this._settings.historyTreeDepth = config.historyTreeDepth
            this._settings.numEpochKeyNoncePerEpoch =
                config.numEpochKeyNoncePerEpoch
            this._settings.fieldCount = config.fieldCount
            this._settings.sumFieldCount = config.sumFieldCount
            this._settings.replNonceBits = config.replNonceBits
            this._settings.replFieldBits = config.replFieldBits
        }
    }

    async request(query) {
        const res = await fetch(this._url, {
            method: 'POST',

            headers: {
                'Content-Type': 'application/json',
            },

            body: JSON.stringify({
                query: query,
            }),
        }).then((res) => res.json())
        return res
    }

    async loadCurrentEpoch(attesterId: bigint | string = this.attesterId) {
        const query = `
        {
            epoches (
                where: {
                    attesterId: "${attesterId.toString()}"
                }
                orderBy: number
            ) {
                number
            }
        }
        `
        const res = await this.request(query)
        return res.data.epoches.length ? Number(res.data.epoches[0]) + 1 : 0
    }

    async genStateTree(
        _epoch: number | bigint,
        attesterId: bigint | string = this.attesterId
    ): Promise<IncrementalMerkleTree> {
        await this.setup()
        const epoch = Number(_epoch.toString())
        const tree = new IncrementalMerkleTree(
            this.settings.stateTreeDepth,
            this.defaultStateTreeLeaf
        )

        const query = `
        {
            stateTreeLeaves (
                orderBy: index, 
                where: {
                    epoch: "${epoch}"
                    attesterId: "${toDecString(attesterId)}"
                }
            ) {
                leaf
            }
        }`
        const res = await this.request(query)
        for (const leaf of res.data.stateTreeLeaves) {
            tree.insert(BigInt(leaf.leaf))
        }
        return tree
    }

    async genEpochTree(
        _epoch: number | bigint,
        attesterId: bigint | string = this.attesterId
    ): Promise<IncrementalMerkleTree> {
        const epoch = Number(_epoch.toString())
        const tree = new IncrementalMerkleTree(
            this.settings.epochTreeDepth,
            this.defaultEpochTreeLeaf
        )
        const query = `
        {
            epochTreeLeaves(
                orderBy: index,
                where: {
                    epoch: "${epoch}"
                    attesterId: "${toDecString(attesterId)}"
                }
            ) {
                leaf
            }
        }`
        const res = await this.request(query)
        for (const leaf of res.data.stateTreeLeaves) {
            tree.insert(BigInt(leaf.leaf))
        }
        return tree
    }

    async genHistoryTree(
        attesterId: bigint | string = this.attesterId
    ): Promise<IncrementalMerkleTree> {
        await this.setup()
        const tree = new IncrementalMerkleTree(
            this.settings.epochTreeDepth,
            this.defaultEpochTreeLeaf
        )
        const query = `
        {
            historyTreeLeaves(
                orderBy: blockTimestamp,
                where: {
                    attesterId: "${toDecString(attesterId)}"
                }
            ) {
                leaf
            }
        }`
        const res = await this.request(query)
        for (const leaf of res.data.historyTreeLeaves) {
            tree.insert(BigInt(leaf.leaf))
        }
        return tree
    }

    async save(db: DB, attesterId: bigint | string | undefined) {
        const attesterId_ = attesterId ? toDecString(attesterId) : undefined
        await db.transaction(async (txDB) => {
            await this.handleStateTreeLeaf(txDB, attesterId_)
            await this.handleEpochTreeLeaf(txDB, attesterId_)
            await this.handleUserSignedUp(txDB, attesterId_)
            await this.handleAttestation(txDB, attesterId_)
            await this.handleUserStateTransitioned(txDB, attesterId_)
            await this.handleEpochEnded(txDB, attesterId_)
            await this.handleAttesterSignedUp(txDB, attesterId_)
            await this.handleHistoryTreeLeaf(txDB, attesterId_)
        })
    }

    async handleStateTreeLeaf(
        db: TransactionDB,
        attesterId: string | undefined
    ) {
        const schema = 'stateTreeLeaves'
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp, 
            ) {
                epoch
                leaf
                index
                attesterId
                blockNumber
                blockTimestamp
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const leaf of res.data[schema]) {
                db.create('StateTreeLeaf', {
                    epoch: Number(leaf.epoch),
                    hash: toDecString(leaf.leaf),
                    index: Number(leaf.index),
                    attesterId: toDecString(leaf.attesterId),
                    blockNumber: Number(leaf.blockNumber),
                })
            }
        }
    }

    async handleEpochTreeLeaf(
        db: TransactionDB,
        attesterId: string | undefined
    ) {
        const schema = `epochTreeLeaves`
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp, 
            ) {
                id
                epoch
                leaf
                index
                attesterId
                blockNumber
                blockTimestamp
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const leaf of res.data[schema]) {
                db.create('EpochTreeLeaf', {
                    id: leaf.id,
                    epoch: Number(leaf.epoch),
                    hash: toDecString(leaf.leaf),
                    index: leaf.index.toString(),
                    attesterId: toDecString(leaf.attesterId),
                    blockNumber: Number(leaf.blockNumber),
                })
            }
        }
    }

    async handleUserSignedUp(
        db: TransactionDB,
        attesterId: string | undefined
    ) {
        const schema = `users`
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp, 
            ) {
                commitment
                epoch
                attesterId
                blockNumber
                blockTimestamp
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const user of res.data[schema]) {
                db.create('UserSignUp', {
                    commitment: user.commitment,
                    epoch: Number(user.epoch),
                    attesterId: user.attesterId,
                    blockNumber: Number(user.blockNumber),
                })
            }
        }
    }

    async handleAttestation(db: TransactionDB, attesterId: string | undefined) {
        const schema = `attestations`
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp, 
            ) {
                id
                epoch
                epochKey
                attesterId
                fieldIndex
                change
                blockNumber
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const attest of res.data[schema]) {
                db.create('Attestation', {
                    epoch: Number(attest.epoch),
                    epochKey: attest.epochKey,
                    attesterId: attest.attesterId,
                    index: attest.id,
                    fieldIndex: Number(attest.fieldIndex),
                    change: attest.change,
                    blockNumber: Number(attest.blockNumber),
                })
            }
        }
    }

    async handleUserStateTransitioned(
        db: TransactionDB,
        attesterId: string | undefined
    ) {
        const schema = `nullifiers`
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp, 
            ) {
                nullifier
                attesterId
                epoch
                transactionHash
                blockNumber
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const nullifier of res.data[schema]) {
                db.create('Nullifier', {
                    epoch: Number(nullifier.epoch),
                    attesterId: nullifier.attesterId,
                    nullifier: nullifier.nullifier,
                    transactionHash: nullifier.transactionHash,
                    blockNumber: Number(nullifier.blockNumber),
                })
            }
        }
    }

    async handleEpochEnded(db: TransactionDB, attesterId: string | undefined) {
        const schema = `epochs`
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp, 
            ) {
                number
                attesterId
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const epoch of res.data[schema]) {
                db.create('Epoch', {
                    number: Number(epoch.number),
                    attesterId: epoch.attesterId,
                    sealed: true,
                })
            }
        }
    }

    async handleAttesterSignedUp(
        db: TransactionDB,
        attesterId: string | undefined
    ) {
        const schema = `attesters`
        const attesterQuery = attesterId ? `attesterId: "${attesterId}"` : ''
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                orderBy: blockTimestamp
                where: {
                    ${attesterQuery}
                    attesterId_not: "0"
                }
            ) {
                attesterId
                startTimestamp
                epochLength
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const attester of res.data[schema]) {
                db.create('Attester', {
                    _id: attester.attesterId,
                    epochLength: Number(attester.epochLength),
                    startTimestamp: Number(attester.startTimestamp),
                })
            }
        }
    }

    async handleHistoryTreeLeaf(
        db: TransactionDB,
        attesterId: string | undefined
    ) {
        const schema = `historyTreeLeaves`
        const mapping = new Map()
        for (let i = 0; ; i++) {
            const query = `
        {
            ${schema} (
                first: ${this.queryCount}
                skip: ${i * this.queryCount}
                ${this.attesterQuery(attesterId)}
                orderBy: blockTimestamp
            ) {
                attesterId
                leaf
            }
        }
        `
            const res = await this.request(query)
            if (res.data[schema].length === 0) return
            for (const leaf of res.data[schema]) {
                if (mapping.get(leaf.attesterId) === undefined) {
                    mapping.set(leaf.attesterId, 0)
                }
                const old = mapping.get(leaf.attesterId)
                mapping.set(leaf.attesterId, old + 1)
                db.create('HistoryTreeLeaf', {
                    attesterId: leaf.attesterId,
                    leaf: leaf.leaf,
                    index: mapping.get(leaf.attesterId),
                })
            }
        }
    }
}
