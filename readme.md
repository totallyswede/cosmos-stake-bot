Stake bot for Cosmos based blockchains (post-Stargate). Give it access to your wallet, point it at a few chains and let it do its thing! Schedule for automatic re-staking, optimizing compounding interest.

## Usage
Built on node, you can run the application in two ways...

The application supports the following chains:

* Cosmos
* Chihuahua
* Osmosis
* Juno
* Lum
* Stargaze
* Like
* Desmos

It supports recieving your mnemonic token via command line, environment variables and by pulling it directly from Azure Key Vault. If you want to deploy the application somewhere in a hosted environment like a public cloud, make sure you protect your secrets as best you can. Might be a good idea to deploy a separate wallet for the assets you want to restake. It's up to you. 

### From the command-line

You need node, npm, yarn and ts-node. 

`npm install -g yarn ts-node`

Install dependencies

`yarn install`


The available CLI paramaters are as follows:

* **--chainNames**: *(string)* Comma separated list of names for chains you want to process
  * Corresponding environment variable: `STAKEBOT_CHAIN_NAMES`
* **--mnemonic**: *(string)* Your wallet mnemonic
  * Corresponding environment variable: `STAKEBOT_MNEMONIC`
* **--keyVaultName**: *(string)* Azure Key Vault name 
  * Corresponding environment variable: `STAKEBOT_KEY_VAULT_NAME`
  * Please note that when using Azure Key Vault, the application also expects the following environment variables to be defined: `AZURE_CLIENT_SECRET`, `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`
* **--keyVaultSecretName**: *(string)* Name of secret inside Azure Key Vault
  * Corresponding environment variable: `STAKEBOT_KEY_VAULT_SECRET_NAME`
* **--claimRewards**: *(boolean)* Sets whether to claim available rewards
  * Corresponding environment variable: `STAKEBOT_CLAIM_REWARDS`
* **--stakeAvailableBalance**: *(boolean)* Sets whether to restake whatever balance is available after rewards have been collected
  * Corresponding environment variable: `STAKEBOT_STAKE_AVAILABLE_BALANCE`
* **--leaveMinimumBalance**: *(integer)* The minimum balance in a given denom to for leave behind when staking. Also half of the minimum amount to consider it's time to withdraw rewards. NOTE! So far applies to all chains you process at the same time!
  * Corresponding environment variable: `STAKEBOT_LEAVE_MINIMUM_BALANCE`

When using Azure Key Vault, run the application like so:

`ts-node index.ts --chainNames=Cosmos,Chihuahua --keyVaultName=MyKeyVaultName --keyVaultSecretName=name-of-secret  --claimRewards=true --stakeAvailableBalance=true`

When supplying mnemonic directly on the command line, use:

`ts-node index.ts --chainNames=Cosmos,Chihuahua --mnemonic="some days are better than others" --claimRewards=true --stakeAvailableBalance=true`


### In Docker

Build the docker image: 

`docker build . -t myrepo.io/cosmos-stake-bot`

Push it

`docker push myrepo.io/cosmos-stake-bot`

Use the image in whatever means you find best for you. The Dockerfile assumes you will feed the application the information it needs via environment variables. 
