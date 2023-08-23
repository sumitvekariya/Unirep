import { BigNumberish } from '@ethersproject/bignumber'

import { Circuit, Prover } from './circuits'
import { SnarkProof } from '@unirep/utils'
import { BaseProof } from './BaseProof'

/**
 * The data proof structure that helps to query the public signals
 */
export class DataProof extends BaseProof {
    readonly idx = {
        stateTreeRoot: 0,
        value: [1, 5],
    }
    public stateTreeRoot: bigint
    public value: bigint[]

    /**
     * @param _publicSignals The public signals of the data proof that can be verified by the prover
     * @param _proof The proof that can be verified by the prover
     * @param prover The prover that can verify the public signals and the proof
     */
    constructor(
        _publicSignals: (bigint | string)[],
        _proof: SnarkProof,
        prover?: Prover
    ) {
        super(_publicSignals, _proof, prover)
        this.stateTreeRoot = this.publicSignals[this.idx.stateTreeRoot]
        this.value = []
        for (let i = this.idx.value[0]; i < this.idx.value[1]; i++) {
            this.value.push(this.publicSignals[i])
        }
        this.circuit = Circuit.dataProof
    }
}
