Stake bot for Cosmos based blockchains (post-Stargate). Give it access to your wallet, point it at a few chains and let it do its thing! Schedule for automatic re-staking, optimizing compounding interest.

Suport multiple wallets, use "accountConfigs.json" to configure mnemonics instead of command line. Please follow the sample config file "accountConfigs_sample.json". The min claimable amount is defined in a global variable called "MIN_REWARD_AMOUNT", which means the amount of token is larger than it will be claimed.

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
* Secret(To be enhanced, rpc endpoint can not be connected)

If you want to deploy the application somewhere in a hosted environment like a public cloud, make sure you protect your secrets as best you can. Might be a good idea to deploy a separate wallet for the assets you want to restake. It's up to you. 

### From the command-line

You need node, npm, yarn and ts-node. 

`npm install -g yarn ts-node`

Install dependencies

`yarn install`


The available CLI paramaters are as follows:

* **--claimRewards**: *(boolean)* Sets whether to claim available rewards, if it's false, the script will query and store all available balances and staking balances in a global map variable called "MapAccountInfo", which is printed in the console for now.
  * Corresponding environment variable: `STAKEBOT_CLAIM_REWARDS`
* **--stakeAvailableBalance**: *(boolean)* Sets whether to restake whatever balance is available after rewards have been collected
  * Corresponding environment variable: `STAKEBOT_STAKE_AVAILABLE_BALANCE`
* **--leaveMinimumBalance**: *(integer)* The minimum balance in a given denom to for leave behind when staking. Also half of the minimum amount to consider it's time to withdraw rewards. NOTE! So far applies to all chains you process at the same time!
  * Corresponding environment variable: `STAKEBOT_LEAVE_MINIMUM_BALANCE`


sample command:

`ts-node index.ts --claimRewards=false --stakeAvailableBalance=false`


### In Docker

Build the docker image: 

`docker build . -t myrepo.io/cosmos-stake-bot`

Push it

`docker push myrepo.io/cosmos-stake-bot`

Use the image in whatever means you find best for you. The Dockerfile assumes you will feed the application the information it needs via environment variables. 
