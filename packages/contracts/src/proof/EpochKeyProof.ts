import { Circuit, Prover } from '@unirep/circuits'
import { SnarkProof } from '@unirep/crypto'
import { BigNumberish } from 'ethers'
import { BaseProof } from './BaseProof'

/**
 * The epoch key proof structure that helps to query the public signals
 */
export class EpochKeyProof extends BaseProof {
    readonly idx = {
        epochKey: 0,
        globalStateTreeRoot: 1,
        epoch: 2,
        attesterId: 3,
    }
    public globalStateTreeRoot: BigNumberish
    public epoch: BigNumberish
    public epochKey: BigNumberish
    public attesterId: BigNumberish

    /**
     * @param _publicSignals The public signals of the epoch key proof that can be verified by the prover
     * @param _proof The proof that can be verified by the prover
     * @param prover The prover that can verify the public signals and the proof
     */
    constructor(
        _publicSignals: BigNumberish[],
        _proof: SnarkProof,
        prover?: Prover
    ) {
        super(_publicSignals, _proof, prover)
        this.epochKey = _publicSignals[this.idx.epochKey].toString()
        this.globalStateTreeRoot =
            _publicSignals[this.idx.globalStateTreeRoot].toString()
        this.epoch = _publicSignals[this.idx.epoch].toString()
        this.attesterId = _publicSignals[this.idx.attesterId].toString()
        this.circuit = Circuit.verifyEpochKey
    }
}
