//@ts-ignore
import { ethers } from 'hardhat'
import { deployUnirep } from '@unirep/contracts/deploy'
import { stringifyBigInts } from '@unirep/utils'
import { SQLiteConnector } from 'anondb/node'
import { schema, UserState } from '@unirep/core'

import { Identity } from '@semaphore-protocol/identity'
import { defaultProver } from '@unirep/circuits/provers/defaultProver'
import { DataProof } from '../../circuits/src'

import defaultConfig from '@unirep/circuits/src/CircuitConfig'
const { SUM_FIELD_COUNT } = defaultConfig

async function genUserStateInternal(id, app) {
    // generate a user state
    const db = await SQLiteConnector.create(schema, ':memory:')
    const unirepAddress = await app.unirep()
    const attesterId = BigInt(app.address)
    const userState = new UserState({
        db,
        attesterId,
        unirepAddress,
        provider: ethers.provider,
        id,
        prover: defaultProver,
    })
    await userState.sync.start()
    await userState.waitForSync()
    return userState
}

describe('Voting', function () {
    this.timeout(0)
    let unirep
    let voting
    const numVoters = 6
    const numOptions = 10
    const epochLength = 300
    // generate random identidies for all voters
    const voters = Array(numVoters)
        .fill(0)
        .map((n) => {
            return new Identity()
        })

    it('deployment', async function () {
        const [deployer] = await ethers.getSigners()
        unirep = await deployUnirep(deployer)
        const verifierF = await ethers.getContractFactory('DataProofVerifier')
        const verifier = await verifierF.deploy()
        await verifier.deployed()
        const VotingF = await ethers.getContractFactory('UnirepVoting')
        voting = await VotingF.deploy(
            unirep.address,
            verifier.address,
            numOptions,
            epochLength
        )
        await voting.deployed()
    })

    it('voter sign up', async () => {
        for (let i = 0; i < numVoters; i++) {
            const userState = await genUserStateInternal(voters[i], voting)
            const { publicSignals, proof } =
                await userState.genUserSignUpProof()
            await voting.userSignUp(publicSignals, proof).then((t) => t.wait())
            userState.sync.stop()
        }
    })

    it('only signed up voter can vote exactly once', async () => {
        for (let i = 0; i < numVoters; i++) {
            let option = i % 4
            const userState = await genUserStateInternal(voters[i], voting)

            const epoch = await userState.sync.loadCurrentEpoch()
            const stateTree = await userState.sync.genStateTree(epoch)
            const index = await userState.latestStateTreeLeafIndex(epoch)
            const stateTreeProof = stateTree.createProof(index)
            const data = await userState.getProvableData()

            const circuitInputs = stringifyBigInts({
                identity_secret: voters[i].secret,
                state_tree_indexes: stateTreeProof.pathIndices,
                state_tree_elements: stateTreeProof.siblings,
                data: data,
                epoch: epoch,
                attester_id: BigInt(voting.address),
                value: data.slice(0, SUM_FIELD_COUNT),
            })
            const p = await defaultProver.genProofAndPublicSignals(
                'dataProof',
                circuitInputs
            )
            const dataProof = new DataProof(
                p.publicSignals,
                p.proof,
                defaultProver
            )
            console.log('option', option)
            console.log('num option', await voting.numOptions())
            console.log('data proof', dataProof)
            await voting
                .vote(option, dataProof.publicSignals, dataProof.proof)
                .then((t) => t.wait())
            userState.sync.stop()
        }
    })
})
