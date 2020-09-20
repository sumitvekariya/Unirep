import chai from "chai"

const { expect } = chai

import {
    compileAndLoadCircuit,
    executeCircuit,
    getSignalByName,
} from './utils'
import { computeAttestationHash, computeNullifier, getNewSMT, bufToBigInt, bigIntToBuf, genNoAttestationNullifierKey } from '../utils'

import {
    genRandomSalt,
    hash5,
    hashLeftRight,
    SnarkBigInt,
} from 'maci-crypto'
import { genIdentity } from 'libsemaphore'
import { BigNumber as smtBN, SparseMerkleTreeImpl } from "../../crypto/SMT"
import { circuitNullifierTreeDepth, circuitUserStateTreeDepth } from "../../config/testLocal"

describe('Process attestation circuit', function () {
    this.timeout(300000)

    let circuit

    const epoch = 1
    const nonce = 0
    const user = genIdentity()
    const NUM_ATTESTATIONS = 3

    let userStateTree: SparseMerkleTreeImpl
    const ONE_LEAF = bigIntToBuf(hashLeftRight(BigInt(1), BigInt(0)))
    let intermediateUserStateTreeRoots, userStateTreePathElements, noAttestationUserStateTreePathElements
    let oldPosReps, oldNegReps, oldGraffities

    let attestationRecords = {}
    let attesterIds: number[], posReps: number[], negReps: number[], graffities: SnarkBigInt[], overwriteGraffitis: boolean[]
    let selectors: number[] = []
    let nullifiers: SnarkBigInt[]
    let hashChainResult: SnarkBigInt

    before(async () => {
        const startCompileTime = Math.floor(new Date().getTime() / 1000)
        circuit = await compileAndLoadCircuit('test/processAttestations_test.circom')
        const endCompileTime = Math.floor(new Date().getTime() / 1000)
        console.log(`Compile time: ${endCompileTime - startCompileTime} seconds`)

        attesterIds = []
        posReps = []
        negReps = []
        graffities = []
        overwriteGraffitis = []

        // User state
        const defaultUserStateLeaf = hash5([BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)])
        userStateTree = await getNewSMT(circuitUserStateTreeDepth, defaultUserStateLeaf)
        intermediateUserStateTreeRoots = []
        userStateTreePathElements = []
        noAttestationUserStateTreePathElements = []
        oldPosReps = []
        oldNegReps = []
        oldGraffities = []
        // Reserve leaf 0
        let result 
        result = await userStateTree.update(new smtBN(0), ONE_LEAF, true)
        expect(result).to.be.true
        // Bootstrap user state
        for (let i = 0; i < NUM_ATTESTATIONS; i++) {
            const  attesterId = i + 1
            if (attestationRecords[attesterId] === undefined) {
                attestationRecords[attesterId] = {
                    posRep: Math.floor(Math.random() * 100),
                    negRep: Math.floor(Math.random() * 100),
                    graffiti: genRandomSalt(),
                }
            }
            const newAttestationRecord = hash5([
                attestationRecords[attesterId]['posRep'],
                attestationRecords[attesterId]['negRep'],
                attestationRecords[attesterId]['graffiti'],
                BigInt(0),
                BigInt(0)
            ])
            const result = await userStateTree.update(new smtBN(attesterId), bigIntToBuf(newAttestationRecord), true)
            expect(result).to.be.true
        }
        intermediateUserStateTreeRoots.push(bufToBigInt(userStateTree.getRootHash()))
        const leafZeroProof = await userStateTree.getMerkleProof(new smtBN(0), ONE_LEAF, true)
        const leafZeroPathElements = leafZeroProof.siblings.map((p) => bufToBigInt(p))
        for (let i = 0; i < NUM_ATTESTATIONS; i++) noAttestationUserStateTreePathElements.push(leafZeroPathElements)

        // Ensure as least one of the selectors is true
        const selTrue = Math.floor(Math.random() * NUM_ATTESTATIONS)
        for (let i = 0; i < NUM_ATTESTATIONS; i++) {
            if (i == selTrue) selectors.push(1)
            else selectors.push(Math.floor(Math.random() * 2))
        }

        nullifiers = []
        hashChainResult = BigInt(0)
        for (let i = 0; i < NUM_ATTESTATIONS; i++) {
            const attestation = {
                attesterId: i + 1,
                posRep: Math.floor(Math.random() * 100),
                negRep: Math.floor(Math.random() * 100),
                graffiti: genRandomSalt(),
                overwriteGraffiti: true,
            }
            attesterIds.push(attestation['attesterId'])
            posReps.push(attestation['posRep'])
            negReps.push(attestation['negRep'])
            graffities.push(attestation['graffiti'])
            overwriteGraffitis.push(attestation['overwriteGraffiti'])

            oldPosReps.push(attestationRecords[attestation['attesterId']]['posRep'])
            oldNegReps.push(attestationRecords[attestation['attesterId']]['negRep'])
            oldGraffities.push(attestationRecords[attestation['attesterId']]['graffiti'])

            if (selectors[i] == 1) {
                // Get old attestation record
                const oldAttestationRecord = hash5([
                    attestationRecords[attestation['attesterId']]['posRep'],
                    attestationRecords[attestation['attesterId']]['negRep'],
                    attestationRecords[attestation['attesterId']]['graffiti'],
                    BigInt(0),
                    BigInt(0)
                ])
                const oldAttestationRecordProof = await userStateTree.getMerkleProof(new smtBN(attestation['attesterId']), bigIntToBuf(oldAttestationRecord), true)
                userStateTreePathElements.push(oldAttestationRecordProof.siblings.map((p) => bufToBigInt(p)))

                // Update attestation record
                attestationRecords[attestation['attesterId']]['posRep'] += attestation['posRep']
                attestationRecords[attestation['attesterId']]['negRep'] += attestation['negRep']
                if (attestation['overwriteGraffiti']) attestationRecords[attestation['attesterId']]['graffiti'] = attestation['graffiti']
                const newAttestationRecord = hash5([
                    attestationRecords[attestation['attesterId']]['posRep'],
                    attestationRecords[attestation['attesterId']]['negRep'],
                    attestationRecords[attestation['attesterId']]['graffiti'],
                    BigInt(0),
                    BigInt(0)
                ])
                result = await userStateTree.update(new smtBN(attestation['attesterId']), bigIntToBuf(newAttestationRecord), true)
                expect(result).to.be.true

                nullifiers.push(computeNullifier(user['identityNullifier'], attestation['attesterId'], epoch, circuitNullifierTreeDepth))

                const attestation_hash = computeAttestationHash(attestation)
                hashChainResult = hashLeftRight(attestation_hash, hashChainResult)
            } else {
                const leafZeroProof = await userStateTree.getMerkleProof(new smtBN(0), ONE_LEAF, true)
                const leafZeroPathElements = leafZeroProof.siblings.map((p) => bufToBigInt(p))
                userStateTreePathElements.push(leafZeroPathElements)

                nullifiers.push(BigInt(0))
            }
            
            intermediateUserStateTreeRoots.push(bufToBigInt(userStateTree.getRootHash()))
        }
        hashChainResult = hashLeftRight(BigInt(1), hashChainResult)
    })

    it('successfully process attestations', async () => {
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }

        const witness = await executeCircuit(circuit, circuitInputs)
        for (let i = 0; i < NUM_ATTESTATIONS; i++) {
            const nullifier = getSignalByName(circuit, witness, 'main.nullifiers[' + i + ']')
            expect(nullifier).to.equal(nullifiers[i])
        }
        const noAtteNullifier = getSignalByName(circuit, witness, 'main.no_attestation_nullifier')
        expect(noAtteNullifier).to.equal(BigInt(0))
    })

    it('successfully process zero attestations', async () => {
        const zeroSelectors = selectors.map(() => 0)
        const noAttestationHashChainResult = hashLeftRight(BigInt(1), BigInt(0))
        const initialUserStateTreeRoot = intermediateUserStateTreeRoots[0]
        const noAttestationIntermediateUserStateTreeRoots = intermediateUserStateTreeRoots.map(() => initialUserStateTreeRoot)
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: noAttestationIntermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: noAttestationUserStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: zeroSelectors,
            hash_chain_result: noAttestationHashChainResult
        }

        const noAttestationNullifier = genNoAttestationNullifierKey(user['identityNullifier'], epoch, nonce, circuitNullifierTreeDepth)
        const witness = await executeCircuit(circuit, circuitInputs)
        const noAtteNullifier = getSignalByName(circuit, witness, 'main.no_attestation_nullifier')
        expect(noAtteNullifier).to.equal(noAttestationNullifier)
    })

    it('process attestations with wrong attestation record should not work', async () => {
        let indexWrongAttestationRecord = Math.floor(Math.random() * NUM_ATTESTATIONS)
        while (selectors[indexWrongAttestationRecord] == 0) indexWrongAttestationRecord = (indexWrongAttestationRecord + 1) % NUM_ATTESTATIONS
        const wrongOldPosReps = oldPosReps.slice()
        wrongOldPosReps[indexWrongAttestationRecord] += Math.floor(Math.random() * 100)
        const wrongOldNegReps = oldNegReps.slice()
        wrongOldNegReps[indexWrongAttestationRecord] += Math.floor(Math.random() * 100)
        const wrongOldGraffities = oldGraffities.slice()
        wrongOldGraffities[indexWrongAttestationRecord] = genRandomSalt()
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: wrongOldPosReps,
            old_neg_reps: wrongOldNegReps,
            old_graffities: wrongOldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }

        let error
        try {
            await executeCircuit(circuit, circuitInputs)
        } catch (e) {
            error = e
            expect(true).to.be.true
        } finally {
            if (!error) throw Error("Root mismatch results from wrong attestation record should throw error")
        }
    })

    it('process attestations with wrong intermediate roots should not work', async () => {
        const wrongIntermediateUserStateTreeRoots = intermediateUserStateTreeRoots.slice()
        const indexWrongRoot = Math.floor(Math.random() * NUM_ATTESTATIONS)
        wrongIntermediateUserStateTreeRoots[indexWrongRoot] = genRandomSalt()
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: wrongIntermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }

        let error
        try {
            await executeCircuit(circuit, circuitInputs)
        } catch (e) {
            error = e
            expect(true).to.be.true
        } finally {
            if (!error) throw Error("Root mismatch results from wrong intermediate roots should throw error")
        }
    })

    it('process attestations with wrong path elements should not work', async () => {
        const indexWrongPathElements = Math.floor(Math.random() * NUM_ATTESTATIONS)
        userStateTreePathElements[indexWrongPathElements].reverse()
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }
        
        let error
        try {
            await executeCircuit(circuit, circuitInputs)
        } catch (e) {
            error = e
            expect(true).to.be.true
        } finally {
            if (!error) throw Error("Root mismatch results from wrong path elements should throw error")
        }

        userStateTreePathElements[indexWrongPathElements].reverse()
    })

    it('process attestations with wrong epoch should fail', async () => {
        const wrongEpoch = epoch + 1
        const circuitInputs = {
            epoch: wrongEpoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }

        const witness = await executeCircuit(circuit, circuitInputs)
        for (let i = 0; i < NUM_ATTESTATIONS; i++) {
            const nullifier = getSignalByName(circuit, witness, 'main.nullifiers[' + i + ']')
            if (selectors[i] == 0) {
                // If selector is false, nullifier should be zero
                expect(nullifier).to.equal(BigInt(0))
            } else {
                // Otherwise nullifier should not be the same as the correct nullifier
                expect(nullifier).to.not.equal(nullifiers[i])
            }
        }
    })

    it('process attestations with wrong nullifier should fail', async () => {
        const otherUser = genIdentity()
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: otherUser['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }

        const witness = await executeCircuit(circuit, circuitInputs)
        for (let i = 0; i < NUM_ATTESTATIONS; i++) {
            const nullifier = getSignalByName(circuit, witness, 'main.nullifiers[' + i + ']')
            if (selectors[i] == 0) {
                // If selector is false, nullifier should be zero
                expect(nullifier).to.equal(BigInt(0))
            } else {
                // Otherwise nullifier should not be the same as the correct nullifier
                expect(nullifier).to.not.equal(nullifiers[i])
            }
        }
    })

    it('process attestations with incorrect number of elements should fail', async () => {
        const wrongAttesterIds = attesterIds.concat([4])
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: wrongAttesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: hashChainResult
        }

        let error
        try {
            await executeCircuit(circuit, circuitInputs)
        } catch (e) {
            error = e
            expect(true).to.be.true
        } finally {
            if (!error) throw Error("Incorrect number of elements should throw error")
        }
    })

    it('process attestations with incorrect hash chain result should fail', async () => {
        const wrongHashChainResult = genRandomSalt()
        const circuitInputs = {
            epoch: epoch,
            nonce: nonce,
            identity_nullifier: user['identityNullifier'],
            intermediate_user_state_tree_roots: intermediateUserStateTreeRoots,
            old_pos_reps: oldPosReps,
            old_neg_reps: oldNegReps,
            old_graffities: oldGraffities,
            path_elements: userStateTreePathElements,
            attester_ids: attesterIds,
            pos_reps: posReps,
            neg_reps: negReps,
            graffities: graffities,
            overwrite_graffitis: overwriteGraffitis,
            selectors: selectors,
            hash_chain_result: wrongHashChainResult
        }

        let error
        try {
            await executeCircuit(circuit, circuitInputs)
        } catch (e) {
            error = e
            expect(true).to.be.true
        } finally {
            if (!error) throw Error("Hash chain result mismatch results from incorrect hash chain result should throw error")
        }
    })
})