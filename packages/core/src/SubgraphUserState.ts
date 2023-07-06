import { Identity } from '@semaphore-protocol/identity'
import { Circuit, Prover, SignupProof } from '@unirep/circuits'
import { toDecString } from './Synchronizer'
import { stringifyBigInts } from '@unirep/utils'
import { SubgraphSynchronizer } from './SubgraphSynchronizer'
import { ethers } from 'ethers'

export class SubgraphUserState extends SubgraphSynchronizer {
    private _id: Identity
    private _prover: Prover

    constructor(config: {
        id: Identity
        url: string
        attesterId: bigint | bigint[]
        provider: ethers.providers.Provider
        prover: Prover
    }) {
        const { id, url, attesterId, provider, prover } = config
        super({ url, attesterId, provider })
        this._id = id

        if (!prover) {
            throw new Error(
                '@unirep/core:UserState: prover must be supplied as an argument when initialized with a sync'
            )
        }
        this._prover = prover
    }

    get id() {
        return this._id
    }

    get prover() {
        return this._prover
    }

    async hasSignedUp(
        attesterId: bigint | string = this.attesterId
    ): Promise<boolean> {
        this.checkAttesterId(attesterId)
        const query = `
        {
            users(
                where: {
                    commitment: "${this.id.commitment.toString()}"
                }
            ) {
                id
            }
        }`
        const res = await this.request(query)
        return res.data.users.length > 0
    }

    // public getData = async (
    //     _toEpoch?: number,
    //     _attesterId: bigint | string = this.attesterId
    // ): Promise<bigint[]> => {
    //     const attesterId = toDecString(_attesterId)
    //     const query = `
    //     {
    //         attestations (
    //             where: {
    //                 attesterId: "${attesterId}"
    //             }
    //         ) {

    //         }
    //     }`
    // }

    public genUserSignUpProof = async (
        options: { epoch?: number; attesterId?: bigint | string } = {}
    ): Promise<SignupProof> => {
        const attesterId = toDecString(options.attesterId ?? this.attesterId)
        const epoch =
            options.epoch ?? (await this.loadCurrentEpoch(this.attesterId))
        const circuitInputs = {
            epoch,
            identity_nullifier: this.id.nullifier,
            identity_trapdoor: this.id.trapdoor,
            attester_id: attesterId,
        }
        const results = await this.prover.genProofAndPublicSignals(
            Circuit.signup,
            stringifyBigInts(circuitInputs)
        )
        return new SignupProof(
            results.publicSignals,
            results.proof,
            this.prover
        )
    }
}
