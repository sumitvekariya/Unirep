// @ts-ignore
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Identity } from '@semaphore-protocol/identity'
import {
    F,
    genRandomSalt,
    IncrementalMerkleTree,
    stringifyBigInts,
} from '@unirep/utils'
import {
    Circuit,
    EpochKeyProof,
    EpochKeyLiteProof,
    ReputationProof,
    SignupProof,
    CircuitConfig,
} from '@unirep/circuits'
import { defaultProver } from '@unirep/circuits/provers/defaultProver'

import { deployVerifierHelper } from '../deploy'
const { STATE_TREE_DEPTH, NUM_EPOCH_KEY_NONCE_PER_EPOCH, FIELD_COUNT } =
    CircuitConfig.default

function randomBits(bit: number) {
    return genRandomSalt() % (BigInt(2) ** BigInt(bit) - BigInt(1))
}

describe('Epoch key lite verifier helper', function () {
    this.timeout(300000)

    let epochKeyLiteVerifierHelper

    before(async () => {
        const accounts = await ethers.getSigners()
        epochKeyLiteVerifierHelper = await deployVerifierHelper(
            accounts[0],
            Circuit.epochKeyLite
        )
    })

    {
        let snapshot
        beforeEach(async () => {
            snapshot = await ethers.provider.send('evm_snapshot', [])
        })

        afterEach(() => ethers.provider.send('evm_revert', [snapshot]))
    }

    it('should verify an epoch key lite proof', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0
        const sig_data = 0

        for (let nonce = 0; nonce < NUM_EPOCH_KEY_NONCE_PER_EPOCH; nonce++) {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.epochKeyLite,
                stringifyBigInts({
                    identity_secret: id.secret,
                    sig_data,
                    epoch,
                    nonce,
                    attester_id: attester.address,
                    reveal_nonce: false,
                })
            )

            const v = await defaultProver.verifyProof(
                Circuit.epochKeyLite,
                r.publicSignals,
                r.proof
            )
            expect(v).to.be.true
            const { publicSignals, proof } = new EpochKeyLiteProof(
                r.publicSignals,
                r.proof
            )
            await epochKeyLiteVerifierHelper.verifyAndCheck(
                publicSignals,
                proof
            )
        }
    })

    it('should decode public signals', async () => {
        // should reveal nonce
        {
            const epoch = randomBits(48)
            const nonce = randomBits(8)
            const attesterId = randomBits(160)
            const revealNonce = true

            const control = EpochKeyLiteProof.buildControl({
                attesterId,
                epoch,
                nonce,
                revealNonce,
            })

            const decodedControl =
                await epochKeyLiteVerifierHelper.decodeEpochKeyControl(control)
            expect(decodedControl.epoch.toString()).to.equal(epoch.toString())
            expect(decodedControl.nonce.toString()).to.equal(nonce.toString())
            expect(decodedControl.attesterId.toString()).to.equal(
                attesterId.toString()
            )
            expect(decodedControl.revealNonce.toString()).to.equal(
                revealNonce.toString()
            )
        }

        // should not reveal nonce
        {
            const epoch = randomBits(48)
            const nonce = randomBits(8)
            const attesterId = randomBits(160)
            const revealNonce = false

            const control = EpochKeyLiteProof.buildControl({
                attesterId,
                epoch,
                nonce,
                revealNonce,
            })

            const decodedControl =
                await epochKeyLiteVerifierHelper.decodeEpochKeyControl(control)
            expect(decodedControl.epoch.toString()).to.equal(epoch.toString())
            expect(decodedControl.nonce.toString()).to.equal('0')
            expect(decodedControl.attesterId.toString()).to.equal(
                attesterId.toString()
            )
            expect(decodedControl.revealNonce.toString()).to.equal('false')
        }
    })

    it('should fail to verify an epoch key lite proof with invalid epoch key', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const attesterId = attester.address

        const epoch = 0
        const data = 0
        const nonce = 0
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.epochKeyLite,
            stringifyBigInts({
                identity_secret: id.secret,
                sig_data: data,
                epoch,
                nonce,
                attester_id: attesterId,
                reveal_nonce: false,
            })
        )

        const v = await defaultProver.verifyProof(
            Circuit.epochKeyLite,
            r.publicSignals,
            r.proof
        )
        expect(v).to.be.true
        const { publicSignals, proof, idx } = new EpochKeyLiteProof(
            r.publicSignals,
            r.proof
        )

        {
            const _publicSignals = [...publicSignals]
            _publicSignals[idx.epochKey] = F
            await expect(
                epochKeyLiteVerifierHelper.verifyAndCheck(_publicSignals, proof)
            ).to.be.revertedWithCustomError(
                epochKeyLiteVerifierHelper,
                'InvalidEpochKey'
            )
        }
    })

    it('should fail to verify an epoch key lite proof with invalid proof', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const attesterId = attester.address

        const epoch = 0
        const data = 0
        const nonce = 0
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.epochKeyLite,
            stringifyBigInts({
                identity_secret: id.secret,
                sig_data: data,
                epoch,
                nonce,
                attester_id: attesterId,
                reveal_nonce: false,
            })
        )

        const v = await defaultProver.verifyProof(
            Circuit.epochKeyLite,
            r.publicSignals,
            r.proof
        )
        expect(v).to.be.true
        const { publicSignals, proof } = new EpochKeyLiteProof(
            r.publicSignals,
            r.proof
        )
        {
            const _proof = [...proof]
            _proof[0] = BigInt(proof[0].toString()) + BigInt(1)
            await expect(
                epochKeyLiteVerifierHelper.verifyAndCheck(publicSignals, _proof)
            ).to.be.reverted
        }

        {
            const _publicSignals = [...publicSignals]
            _publicSignals[0] = BigInt(publicSignals[0].toString()) + BigInt(1)
            await expect(
                epochKeyLiteVerifierHelper.verifyAndCheck(_publicSignals, proof)
            ).to.be.revertedWithCustomError(
                epochKeyLiteVerifierHelper,
                'InvalidProof'
            )
        }
    })

    it('verify that msg.sender is the same as attesterId', async () => {
        const accounts = await ethers.getSigners()
        const owner = accounts[0]
        const id = new Identity()
        const epoch = 0
        const sig_data = 0
        const nonce = 0
        {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.epochKeyLite,
                stringifyBigInts({
                    identity_secret: id.secret,
                    sig_data,
                    epoch,
                    nonce,
                    attester_id: owner.address,
                    reveal_nonce: false,
                })
            )

            const { publicSignals, proof } = new EpochKeyLiteProof(
                r.publicSignals,
                r.proof
            )
            await expect(
                epochKeyLiteVerifierHelper
                    .connect(owner)
                    .verifyAndCheckCaller(publicSignals, proof)
            ).to.not.be.reverted
        }
        {
            const randomAddress = BigInt(10)
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.epochKeyLite,
                stringifyBigInts({
                    identity_secret: id.secret,
                    sig_data,
                    epoch,
                    nonce,
                    attester_id: randomAddress,
                    reveal_nonce: false,
                })
            )
            const { publicSignals, proof } = new EpochKeyLiteProof(
                r.publicSignals,
                r.proof
            )
            await expect(
                epochKeyLiteVerifierHelper
                    .connect(owner)
                    .verifyAndCheckCaller(publicSignals, proof)
            ).to.be.revertedWithCustomError(
                epochKeyLiteVerifierHelper,
                'CallerInvalid'
            )
        }
    })
})

describe('Epoch key verifier helper', function () {
    this.timeout(500000)

    let epochKeyVerifierHelper

    before(async () => {
        const accounts = await ethers.getSigners()
        epochKeyVerifierHelper = await deployVerifierHelper(
            accounts[0],
            Circuit.epochKey
        )
    })

    {
        let snapshot
        beforeEach(async () => {
            snapshot = await ethers.provider.send('evm_snapshot', [])
        })

        afterEach(() => ethers.provider.send('evm_revert', [snapshot]))
    }

    it('should verify an epoch key proof', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const attesterId = attester.address
        const id = new Identity()
        const epoch = 0

        // sign up a user
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.signup,
            stringifyBigInts({
                epoch: epoch.toString(),
                identity_nullifier: id.nullifier,
                identity_trapdoor: id.trapdoor,
                attester_id: attesterId,
            })
        )
        const { stateTreeLeaf: leaf } = new SignupProof(
            r.publicSignals,
            r.proof,
            defaultProver
        )

        const index = 0
        const stateTree = new IncrementalMerkleTree(STATE_TREE_DEPTH)
        stateTree.insert(leaf)

        const merkleProof = stateTree.createProof(index)
        const data = 0
        for (let nonce = 0; nonce < NUM_EPOCH_KEY_NONCE_PER_EPOCH; nonce++) {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.epochKey,
                stringifyBigInts({
                    state_tree_elements: merkleProof.siblings,
                    state_tree_indexes: merkleProof.pathIndices,
                    identity_secret: id.secret,
                    data: Array(FIELD_COUNT).fill(0),
                    sig_data: data,
                    epoch,
                    nonce,
                    attester_id: attester.address,
                    reveal_nonce: false,
                })
            )

            const v = await defaultProver.verifyProof(
                Circuit.epochKey,
                r.publicSignals,
                r.proof
            )
            expect(v).to.be.true
            const { publicSignals, proof, ...proofFields } = new EpochKeyProof(
                r.publicSignals,
                r.proof
            )
            const signals = await epochKeyVerifierHelper.verifyAndCheck(
                publicSignals,
                proof
            )
            expect(signals.epochKey.toString()).to.equal(
                proofFields.epochKey.toString()
            )
            expect(signals.stateTreeRoot.toString()).to.equal(
                proofFields.stateTreeRoot.toString()
            )
            expect(signals.data.toString()).to.equal(
                proofFields.data.toString()
            )
            expect(signals.attesterId.toString()).to.equal(
                proofFields.attesterId.toString()
            )
            expect(signals.epoch.toString()).to.equal(
                proofFields.epoch.toString()
            )
            expect(signals.nonce.toString()).to.equal(
                proofFields.nonce.toString()
            )
        }
    })

    it('should decode public signals', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0

        // sign up a user
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.signup,
            stringifyBigInts({
                epoch: epoch.toString(),
                identity_nullifier: id.nullifier,
                identity_trapdoor: id.trapdoor,
                attester_id: attester.address,
            })
        )
        const { stateTreeLeaf: leaf } = new SignupProof(
            r.publicSignals,
            r.proof,
            defaultProver
        )

        const index = 0

        const stateTree = new IncrementalMerkleTree(STATE_TREE_DEPTH)
        stateTree.insert(leaf)

        const merkleProof = stateTree.createProof(index)
        const data = 0
        for (let nonce = 0; nonce < NUM_EPOCH_KEY_NONCE_PER_EPOCH; nonce++) {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.epochKey,
                stringifyBigInts({
                    state_tree_elements: merkleProof.siblings,
                    state_tree_indexes: merkleProof.pathIndices,
                    identity_secret: id.secret,
                    data: Array(FIELD_COUNT).fill(0),
                    sig_data: data,
                    epoch,
                    nonce,
                    attester_id: attester.address,
                    reveal_nonce: false,
                })
            )

            const v = await defaultProver.verifyProof(
                Circuit.epochKey,
                r.publicSignals,
                r.proof
            )
            expect(v).to.be.true
            const proof = new EpochKeyProof(r.publicSignals, r.proof)
            const signals = await epochKeyVerifierHelper.decodeEpochKeySignals(
                proof.publicSignals
            )
            expect(signals.epochKey.toString()).to.equal(
                proof.epochKey.toString()
            )
            expect(signals.stateTreeRoot.toString()).to.equal(
                proof.stateTreeRoot.toString()
            )
            expect(signals.data.toString()).to.equal(proof.data.toString())
            expect(signals.attesterId.toString()).to.equal(
                proof.attesterId.toString()
            )
            expect(signals.epoch.toString()).to.equal(proof.epoch.toString())
            expect(signals.nonce.toString()).to.equal(proof.nonce.toString())
            await epochKeyVerifierHelper.verifyAndCheck(
                proof.publicSignals,
                proof.proof
            )
        }
    })

    it('should fail to verify an epoch key proof with invalid epoch key', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0
        const data = 0
        const nonce = 0
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.epochKey,
            stringifyBigInts({
                state_tree_elements: new Array(STATE_TREE_DEPTH).fill(0),
                state_tree_indexes: new Array(STATE_TREE_DEPTH).fill(0),
                identity_secret: id.secret,
                data: Array(FIELD_COUNT).fill(0),
                sig_data: data,
                epoch,
                nonce,
                attester_id: attester.address,
                reveal_nonce: false,
            })
        )
        const v = await defaultProver.verifyProof(
            Circuit.epochKey,
            r.publicSignals,
            r.proof
        )
        expect(v).to.be.true
        const { publicSignals, proof, idx } = new EpochKeyProof(
            r.publicSignals,
            r.proof
        )

        {
            const _publicSignals = [...publicSignals]
            _publicSignals[idx.epochKey] = F
            await expect(
                epochKeyVerifierHelper.verifyAndCheck(_publicSignals, proof)
            ).to.be.revertedWithCustomError(
                epochKeyVerifierHelper,
                'InvalidEpochKey'
            )
        }
    })

    it('should fail to verify an epoch key proof with invalid proof', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0
        const data = 0
        const nonce = 0
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.epochKey,
            stringifyBigInts({
                state_tree_elements: new Array(STATE_TREE_DEPTH).fill(0),
                state_tree_indexes: new Array(STATE_TREE_DEPTH).fill(0),
                identity_secret: id.secret,
                data: Array(FIELD_COUNT).fill(0),
                sig_data: data,
                epoch,
                nonce,
                attester_id: attester.address,
                reveal_nonce: false,
            })
        )

        const v = await defaultProver.verifyProof(
            Circuit.epochKey,
            r.publicSignals,
            r.proof
        )
        expect(v).to.be.true
        const { publicSignals, proof } = new EpochKeyProof(
            r.publicSignals,
            r.proof
        )
        {
            const _proof = [...proof].map((x) => BigInt(x))
            _proof[0] = BigInt(proof[0].toString()) + BigInt(1)
            await expect(
                epochKeyVerifierHelper.verifyAndCheck(publicSignals, _proof)
            ).to.be.reverted
        }

        {
            const _publicSignals = [...publicSignals]
            _publicSignals[0] = BigInt(publicSignals[0].toString()) + BigInt(1)
            await expect(
                epochKeyVerifierHelper.verifyAndCheck(_publicSignals, proof)
            ).to.be.revertedWithCustomError(
                epochKeyVerifierHelper,
                'InvalidProof'
            )
        }
    })

    it('verify that msg.sender is the same as attesterId', async () => {
        const accounts = await ethers.getSigners()
        const owner = accounts[0]
        const id = new Identity()
        const epoch = 0
        {
            const data = 0
            const nonce = 0
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.epochKey,
                stringifyBigInts({
                    state_tree_elements: new Array(STATE_TREE_DEPTH).fill(0),
                    state_tree_indexes: new Array(STATE_TREE_DEPTH).fill(0),
                    identity_secret: id.secret,
                    data: Array(FIELD_COUNT).fill(0),
                    sig_data: data,
                    epoch,
                    nonce,
                    attester_id: owner.address,
                    reveal_nonce: false,
                })
            )

            const { publicSignals, proof } = new EpochKeyProof(
                r.publicSignals,
                r.proof
            )
            await expect(
                epochKeyVerifierHelper
                    .connect(owner)
                    .verifyAndCheckCaller(publicSignals, proof)
            ).to.not.be.revertedWithCustomError(
                epochKeyVerifierHelper,
                'CallerInvalid'
            )
        }
    })
})

describe('Reputation verifier helper', function () {
    this.timeout(120000)

    const zeroCircuitInputs = {
        identity_secret: 0,
        state_tree_indexes: 0,
        state_tree_elements: 0,
        data: Array(FIELD_COUNT).fill(0),
        prove_graffiti: 0,
        graffiti: 0,
        reveal_nonce: false,
        attester_id: 0,
        epoch: 0,
        nonce: 0,
        min_rep: 0,
        max_rep: 0,
        prove_min_rep: 0,
        prove_max_rep: 0,
        prove_zero_rep: 0,
        sig_data: 696969,
    }

    let repVerifierHelper
    before(async () => {
        const accounts = await ethers.getSigners()
        repVerifierHelper = await deployVerifierHelper(
            accounts[0],
            Circuit.proveReputation
        )
    })

    {
        let snapshot
        beforeEach(async () => {
            snapshot = await ethers.provider.send('evm_snapshot', [])
        })

        afterEach(() => ethers.provider.send('evm_revert', [snapshot]))
    }

    it('should verify a reputation proof', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0

        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.signup,
            stringifyBigInts({
                epoch: epoch.toString(),
                identity_nullifier: id.nullifier,
                identity_trapdoor: id.trapdoor,
                attester_id: attester.address,
            })
        )
        const { stateTreeLeaf: leaf } = new SignupProof(
            r.publicSignals,
            r.proof,
            defaultProver
        )

        const index = 0

        const stateTree = new IncrementalMerkleTree(STATE_TREE_DEPTH)
        stateTree.insert(leaf)

        const merkleProof = stateTree.createProof(index)
        for (let nonce = 0; nonce < NUM_EPOCH_KEY_NONCE_PER_EPOCH; nonce++) {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.proveReputation,
                stringifyBigInts({
                    ...zeroCircuitInputs,
                    identity_secret: id.secret,
                    state_tree_indexes: merkleProof.pathIndices,
                    state_tree_elements: merkleProof.siblings,
                    attester_id: attester.address,
                    epoch,
                    nonce,
                })
            )
            const v = await defaultProver.verifyProof(
                Circuit.proveReputation,
                r.publicSignals,
                r.proof
            )
            expect(v).to.be.true
            const { publicSignals, proof, ...proofFields } =
                new ReputationProof(r.publicSignals, r.proof)
            const signals = await repVerifierHelper.verifyAndCheck(
                publicSignals,
                proof
            )
            expect(signals.epochKey.toString()).to.equal(
                proofFields.epochKey.toString()
            )
            expect(signals.stateTreeRoot.toString()).to.equal(
                proofFields.stateTreeRoot.toString()
            )
            expect(signals.maxRep.toString()).to.equal(
                proofFields.maxRep.toString()
            )
            expect(signals.minRep.toString()).to.equal(
                proofFields.minRep.toString()
            )
            expect(signals.attesterId.toString()).to.equal(
                proofFields.attesterId.toString()
            )
            expect(signals.epoch.toString()).to.equal(
                proofFields.epoch.toString()
            )
            expect(signals.nonce.toString()).to.equal(
                proofFields.nonce.toString()
            )
        }
    })

    it('should decode public signals', async () => {
        const epoch = randomBits(64)
        const nonce = randomBits(8)
        const attesterId = randomBits(160)
        const revealNonce = false

        for (let proveMinRep = 0; proveMinRep < 2; proveMinRep++) {
            for (let proveMaxRep = 0; proveMaxRep < 2; proveMaxRep++) {
                for (let proveZeroRep = 0; proveZeroRep < 2; proveZeroRep++) {
                    for (
                        let proveGraffiti = 0;
                        proveGraffiti < 2;
                        proveGraffiti++
                    ) {
                        const maxRep = randomBits(64)
                        const minRep = randomBits(64)
                        const control = ReputationProof.buildControl({
                            attesterId,
                            epoch,
                            nonce,
                            revealNonce,
                            proveGraffiti,
                            minRep,
                            maxRep,
                            proveMinRep,
                            proveMaxRep,
                            proveZeroRep,
                        })
                        const decodedControl =
                            await repVerifierHelper.decodeReputationControl(
                                control[1]
                            )
                        expect(decodedControl.minRep.toString()).to.equal(
                            minRep.toString()
                        )
                        expect(decodedControl.maxRep.toString()).to.equal(
                            maxRep.toString()
                        )
                        expect(decodedControl.proveMinRep).to.equal(
                            Boolean(proveMinRep)
                        )
                        expect(decodedControl.proveMaxRep).to.equal(
                            Boolean(proveMaxRep)
                        )
                        expect(decodedControl.proveZeroRep).to.equal(
                            Boolean(proveZeroRep)
                        )
                        expect(decodedControl.proveGraffiti).to.equal(
                            Boolean(proveGraffiti)
                        )
                    }
                }
            }
        }
    })

    it('should fail to verify a reputation proof with invalid epoch key', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0
        const index = 0
        const stateTree = new IncrementalMerkleTree(STATE_TREE_DEPTH)

        {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.signup,
                stringifyBigInts({
                    epoch: epoch.toString(),
                    identity_nullifier: id.nullifier,
                    identity_trapdoor: id.trapdoor,
                    attester_id: attester.address,
                })
            )
            const { stateTreeLeaf: leaf } = new SignupProof(
                r.publicSignals,
                r.proof,
                defaultProver
            )

            stateTree.insert(leaf)
        }

        const invalidEpoch = 3333
        const merkleProof = stateTree.createProof(index)
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.proveReputation,
            stringifyBigInts({
                ...zeroCircuitInputs,
                identity_secret: id.secret,
                state_tree_indexes: merkleProof.pathIndices,
                state_tree_elements: merkleProof.siblings,
                attester_id: attester.address,
                epoch: invalidEpoch,
            })
        )

        const v = await defaultProver.verifyProof(
            Circuit.proveReputation,
            r.publicSignals,
            r.proof
        )
        expect(v).to.be.true
        const { publicSignals, proof, idx } = new ReputationProof(
            r.publicSignals,
            r.proof
        )

        {
            const _publicSignals = [...publicSignals]
            _publicSignals[idx.epochKey] = F
            await expect(
                repVerifierHelper.verifyAndCheck(_publicSignals, proof)
            ).to.be.revertedWithCustomError(
                repVerifierHelper,
                'InvalidEpochKey'
            )
        }
    })

    it('should fail to verify a reputation proof with invalid proof', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const id = new Identity()
        const epoch = 0
        const index = 0
        const stateTree = new IncrementalMerkleTree(STATE_TREE_DEPTH)

        {
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.signup,
                stringifyBigInts({
                    epoch: epoch.toString(),
                    identity_nullifier: id.nullifier,
                    identity_trapdoor: id.trapdoor,
                    attester_id: attester.address,
                })
            )
            const { stateTreeLeaf: leaf } = new SignupProof(
                r.publicSignals,
                r.proof,
                defaultProver
            )

            stateTree.insert(leaf)
        }

        const merkleProof = stateTree.createProof(index)
        const r = await defaultProver.genProofAndPublicSignals(
            Circuit.proveReputation,
            stringifyBigInts({
                ...zeroCircuitInputs,
                identity_secret: id.secret,
                state_tree_indexes: merkleProof.pathIndices,
                state_tree_elements: merkleProof.siblings,
                attester_id: attester.address,
                epoch,
            })
        )

        const { publicSignals, proof } = new ReputationProof(
            r.publicSignals,
            r.proof
        )
        {
            const _proof = [...proof]
            _proof[0] = BigInt(proof[0].toString()) + BigInt(1)
            await expect(
                repVerifierHelper.verifyAndCheck(publicSignals, _proof)
            ).to.be.reverted
        }

        {
            const _publicSignals = [...publicSignals]
            _publicSignals[0] = BigInt(publicSignals[0].toString()) + BigInt(1)
            await expect(
                repVerifierHelper.verifyAndCheck(_publicSignals, proof)
            ).to.be.revertedWithCustomError(repVerifierHelper, 'InvalidProof')
        }
    })

    it('verify that caller is the same as attesterId', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[0]
        const id = new Identity()
        const epoch = 0

        {
            const nonce = 0
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.proveReputation,
                stringifyBigInts({
                    ...zeroCircuitInputs,
                    identity_secret: id.secret,
                    state_tree_indexes: new Array(STATE_TREE_DEPTH).fill(0),
                    state_tree_elements: new Array(STATE_TREE_DEPTH).fill(0),
                    attester_id: attester.address,
                    epoch,
                    nonce,
                })
            )
            const { publicSignals, proof } = new ReputationProof(
                r.publicSignals,
                r.proof
            )
            await expect(
                repVerifierHelper
                    .connect(attester)
                    .verifyAndCheckCaller(publicSignals, proof)
            ).to.not.be.reverted
        }
        {
            const nonce = 0
            const randomAddress = randomBits(160)
            const r = await defaultProver.genProofAndPublicSignals(
                Circuit.proveReputation,
                stringifyBigInts({
                    ...zeroCircuitInputs,
                    identity_secret: id.secret,
                    state_tree_indexes: new Array(STATE_TREE_DEPTH).fill(0),
                    state_tree_elements: new Array(STATE_TREE_DEPTH).fill(0),
                    attester_id: randomAddress,
                    epoch,
                    nonce,
                })
            )
            const { publicSignals, proof } = new ReputationProof(
                r.publicSignals,
                r.proof
            )
            await expect(
                repVerifierHelper
                    .connect(attester)
                    .verifyAndCheckCaller(publicSignals, proof)
            ).to.be.revertedWithCustomError(repVerifierHelper, 'CallerInvalid')
        }
    })
})
