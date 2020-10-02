#!/bin/bash

set -e

cd "$(dirname "$0")"
cd ..
mkdir -p build

NODE_OPTIONS=--max-old-space-size=8192 npx ts-node scripts/buildSnarks.ts -i circuits/test/proveReputation_test.circom -j build/proveReputationCircuit.r1cs -w build/proveReputation.wasm -p build/proveReputationPk.json -v build/proveReputationVk.json -s build/ReputationVerifier.sol -vs ReputationVerifier -pr build/proveReputation.params

echo 'Copying ReputationVerifier.sol to contracts/'
cp ./build/ReputationVerifier.sol ./contracts/