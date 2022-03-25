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
* Secret

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


## sample command:

query available balances and staking balances from configured accounts in `accountConfig.json`

`ts-node index.ts --claimRewards=false --stakeAvailableBalance=false`

claim all rewareds

`ts-node index.ts --claimRewards=true --stakeAvailableBalance=false`

batch transfer,use batchConfig.json to support many to one and one to many transfer. Use accountName to link the account configurations in `accountConfigs.json`.

`ts-node batchTransfer.ts`

Vote for all available governace proposals.

`ts-node vote.ts`
