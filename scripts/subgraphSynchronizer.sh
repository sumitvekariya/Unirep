#!/bin/bash
docker stop $(docker ps -a -q) 
docker rm $(docker ps -a -q)

rm -rf packages/subgraph/data

PROVIDER="http://127.0.0.1:18545/";
FOUND=0;

yarn subgraph node &

while [ $FOUND == 0 ]
do
    curl $PROVIDER &> /dev/null
    if [[ "$?" -eq 0 ]]; then
        echo "Found provider";
        FOUND=1;
    fi
    sleep 5
done

yarn contracts deploy --network subgraph &&
yarn subgraph build:local

CREATED=0;
while [ $CREATED == 0 ] 
do
    if yarn subgraph create:local; then
        echo "created";
        CREATED=1;
        
    fi
    sleep 5
done

yarn subgraph deploy:local &&

yarn core test:subgraph &&

exit 0