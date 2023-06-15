// @ts-ignore
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { Identity } from '@semaphore-protocol/identity'
import { deployUnirep } from '@unirep/contracts/deploy'

import { genUserState } from './utils'
import { genEpochKey } from '@unirep/utils'

const EPOCH_LENGTH = 1000

describe('Bug', function () {
    this.timeout(30 * 60 * 1000)

    let unirepContract
    const numVoters = 5
    const numHackers = 6
    const voter = Array(numVoters)
        .fill(0)
        .map((n) => {
            return new Identity()
        })
    const hacker = Array(numHackers)
        .fill(0)
        .map((n) => {
            return new Identity()
        })
    const epks: any[] = []


    before(async () => {
        const accounts = await ethers.getSigners()
        unirepContract = await deployUnirep(accounts[0])
        const attester = accounts[1]
            await unirepContract
                .connect(attester)
                .attesterSignUp(EPOCH_LENGTH)
                .then((t) => t.wait())
    })

    it('user sign up and receive attestation', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const attesterId = BigInt(attester.address)
        for (let i = 0; i < numVoters; i++) {
            const userState = await genUserState(
                ethers.provider,
                unirepContract.address,
                voter[i],
                attesterId
            )
            {
                const { publicSignals, proof } =
                    await userState.genUserSignUpProof()
                await unirepContract
                    .connect(attester)
                    .userSignUp(publicSignals, proof)
                    .then((t) => t.wait())
            }
        }

        for (let i = 0; i < numHackers; i++) {
            const userState = await genUserState(
                ethers.provider,
                unirepContract.address,
                hacker[i],
                attesterId
            )
            {
                const { publicSignals, proof } =
                    await userState.genUserSignUpProof()
                await unirepContract
                    .connect(attester)
                    .userSignUp(publicSignals, proof)
                    .then((t) => t.wait())
            }
            epks.push(genEpochKey(hacker[i].secret, attesterId, 0, 0))
        }
    })

    it('vote', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const attesterId = BigInt(attester.address)
        for (let i = 0; i < numVoters; i++) {
            const userState = await genUserState(
                ethers.provider,
                unirepContract.address,
                voter[i],
                attesterId
            )
            const fieldIndex = i % 4
            const epkIdx = i % numHackers

            await unirepContract.connect(attester)
                .attest(epks[epkIdx], 0, fieldIndex, 1)
                .then((t) => t.wait())
            await userState.waitForSync()
            console.log('offchain epoch tree', (await userState.sync.genEpochTree(0)).root)
            userState.sync.stop()
        }

        for (let i = 0; i < numHackers; i++) {
            const userState = await genUserState(
                ethers.provider,
                unirepContract.address,
                hacker[i],
                attesterId
            )
            const fieldIndex = (i + 2) % 4
            const epkIdx = (i + 4) % numHackers
            await unirepContract
            .connect(attester).attest(epks[epkIdx], 0, fieldIndex, 1)
                .then((t) => t.wait())
            await userState.waitForSync()
            console.log('offchain epoch tree', (await userState.sync.genEpochTree(0)).root)
            userState.sync.stop()
        }

    })

    it('user state transition', async () => {
        const accounts = await ethers.getSigners()
        const attester = accounts[1]
        const attesterId = BigInt(attester.address)
        await ethers.provider.send('evm_increaseTime', [EPOCH_LENGTH])
        await ethers.provider.send('evm_mine', [])

        for (let i = 0; i < numHackers; i++) {
            const newEpoch = await unirepContract.attesterCurrentEpoch(
                attesterId
            )
            const userState = await genUserState(
                ethers.provider,
                unirepContract.address,
                hacker[i],
                attesterId
            )
            const { publicSignals, proof } =
                await userState.genUserStateTransitionProof({
                    toEpoch: newEpoch,
                })
            await unirepContract
                .userStateTransition(publicSignals, proof)
                .then((t) => t.wait())
            userState.sync.stop()
        }
    })


})
