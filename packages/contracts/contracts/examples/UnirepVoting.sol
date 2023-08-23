// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;
import {Unirep} from '.././Unirep.sol';

// Uncomment this line to use console.log
import "hardhat/console.sol";
import {BaseVerifierHelper} from '../verifierHelpers/BaseVerifierHelper.sol';

interface IVerifier {
    function verifyProof(
        uint256[6] calldata publicSignals,
        uint256[8] calldata proof
    ) external view returns (bool);
}

contract UnirepVoting {
    Unirep public unirep;
    BaseVerifierHelper public verifier;
    IVerifier internal dataVerifier;
    uint8 public numOptions;
    int[] public scores;
    mapping(uint256 => uint256) public voted;

    constructor(
        Unirep _unirep,
        IVerifier _dataVerifier,
        uint8 _numOptions,
        uint48 _epochLength
    ) {
        // set unirep address
        unirep = _unirep;

        // set verifier address
        dataVerifier = _dataVerifier;

        _numOptions = numOptions;
        scores = new int[](numOptions);

        unirep.attesterSignUp(_epochLength);
    }

    // sign up users in this app
    function userSignUp(
        uint256[] calldata publicSignals,
        uint256[8] calldata proof
    ) public {
        unirep.userSignUp(publicSignals, proof);
    }

    function vote(
        uint256 option,
        uint256[6] calldata publicSignals,
        uint256[8] calldata proof
    ) public {
        console.log('vote %s, %s', option, numOptions);
        require(option < numOptions, 'voted option out of range');

        BaseVerifierHelper.EpochKeySignals memory signals;

        signals.epochKey = publicSignals[0];
        signals.stateTreeRoot = publicSignals[1];
        (
            signals.revealNonce,
            signals.attesterId,
            signals.epoch,
            signals.nonce
        ) = verifier.decodeEpochKeyControl(publicSignals[2]);

        require(signals.revealNonce == true, 'reveal nonce wrong');
        require(signals.nonce == 1, 'nonce wrong');

        verifyDataProof(publicSignals, proof);

        require(voted[signals.epochKey] == 0, 'Already voted');
        voted[signals.epochKey] += 1;
        scores[option] += 1;

        uint48 epoch = unirep.attesterCurrentEpoch(uint160(address(this)));
        require(epoch == 0, 'not voting epoch');
    }

    function verifyDataProof(
        uint256[6] calldata publicSignals,
        uint256[8] calldata proof
    ) public view returns (bool) {
        return dataVerifier.verifyProof(publicSignals, proof);
    }
}
