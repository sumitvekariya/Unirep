// @ts-ignore
import { expect } from 'chai'
import { Identity } from '@semaphore-protocol/identity'
import {
    IncrementalMerkleTree,
    genIdentityHash,
    genStateTreeLeaf,
} from '@unirep/utils'
import { getUnirepContract } from '@unirep/contracts'
import { defaultProver as prover } from '@unirep/circuits/provers/defaultProver'

import { SubgraphUserState } from '../../src'
import { getSigners, provider, unirepAddress, url } from './config'

const EPOCH_LENGTH = 1000

describe('User Signup', function () {
    this.timeout(30 * 60 * 1000)

    let unirep
    let attesterId

    let stateTree

    before(async () => {
        const accounts = getSigners()
        unirep = getUnirepContract(unirepAddress, accounts[0])
        const attester = accounts[1]
        await unirep
            .connect(attester)
            .attesterSignUp(EPOCH_LENGTH)
            .then((t) => t.wait())
        attesterId = BigInt(attester.address)

        const treeDepth = await unirep.stateTreeDepth()
        stateTree = new IncrementalMerkleTree(treeDepth, BigInt(0))
    })

    it('sign up users with no initial data', async () => {
        const accounts = getSigners()
        const attester = accounts[1]

        for (let i = 0; i < 10; i++) {
            const id = new Identity(`user${i}`)
            const userState = new SubgraphUserState({
                id,
                url,
                prover,
                attesterId,
                provider,
            })

            const { publicSignals, proof, stateTreeLeaf } =
                await userState.genUserSignUpProof()
            stateTree.insert(stateTreeLeaf)
            await unirep
                .connect(attester)
                .userSignUp(publicSignals, proof)
                .then((t: any) => t.wait())

            for (let j = 0; j < 10; j++) {
                const onchainRoot = await unirep.attesterStateTreeRoot(
                    attester.address
                )
                const subgraphStateTree = await userState.genStateTree(0)
                if (
                    subgraphStateTree.root.toString() === onchainRoot.toString()
                ) {
                    expect(stateTree.root.toString()).to.equal(
                        subgraphStateTree.root.toString()
                    )
                    const hasSignedup = await userState.hasSignedUp()
                    expect(hasSignedup).to.be.true
                    break
                }
                if (j === 9) {
                    expect(true).to.be.false
                }
                await new Promise((r) => setTimeout(r, 1000))
            }
        }
    })

    it('should sign up user with initial data', async () => {
        const accounts = getSigners()
        const attester = accounts[1]

        const id = new Identity(`user${10}`)
        const userState = new SubgraphUserState({
            id,
            url,
            prover,
            attesterId,
            provider,
        })

        const epoch = await userState.loadCurrentEpoch()
        const config = await unirep.config()
        const data = Array(config.fieldCount)
            .fill(0)
            .map((_, i) => {
                return i + 100
            })
        const expectedData = data.map((d, i) => {
            if (i < config.sumFieldCount) {
                return d
            } else {
                return BigInt(d) << BigInt(config.replNonceBits)
            }
        })

        const stateTreeLeaf = genStateTreeLeaf(
            id.secret,
            attester.address,
            epoch,
            expectedData
        )
        const idHash = genIdentityHash(id.secret, attester.address, epoch)

        stateTree.insert(stateTreeLeaf)
        await unirep
            .connect(attester)
            .manualUserSignUp(epoch, id.commitment, idHash, data)
            .then((t) => t.wait())
        const stateTreeRoot = await unirep.attesterStateTreeRoot(
            attester.address
        )

        for (let j = 0; j < 1; j++) {
            const onchainRoot = await unirep.attesterStateTreeRoot(
                attester.address
            )
            const subgraphStateTree = await userState.genStateTree(0)

            if (subgraphStateTree.root.toString() === onchainRoot.toString()) {
                expect(stateTree.root.toString()).to.equal(
                    subgraphStateTree.root.toString()
                )
                const hasSignedup = await userState.hasSignedUp()
                expect(hasSignedup).to.be.true
                break
            }
            if (j === 9) {
                expect(true).to.be.false
            }
            await new Promise((r) => setTimeout(r, 1000))
        }
    })
})
