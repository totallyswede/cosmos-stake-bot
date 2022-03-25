import { E6,IAccountConfiguration, IChainConfiguration, GenerateFee} from "./common";

import { cosmosclient, rest, proto } from 'cosmos-client';
import { AccAddress } from 'cosmos-client/cjs/types';

interface IClientInfos {
    rest : cosmosclient.CosmosSDK,
    rpc : SigningStargateClient,
    restAddress: AccAddress
  }

import {
    QueryClient, setupGovExtension, setupBankExtension, SigningStargateClient, BankExtension, GovExtension

} from "@cosmjs/stargate";
import { DirectSecp256k1HdWallet, Registry } from "@cosmjs/proto-signing";
import { HdPath, stringToPath } from "@cosmjs/crypto";

import { setBech32NetworkPrefix } from 'cosmos-client/esm/types/address/config'

import { Tendermint34Client } from '@cosmjs/tendermint-rpc';
import { coins, Secp256k1HdWallet } from '@cosmjs/launchpad'
import dotenv from 'dotenv';
import { InlineResponse20035BlockEvidenceLightClientAttackEvidenceConflictingBlockSignedHeaderCommitSignaturesBlockIdFlagEnum } from "cosmos-client/cjs/openapi/api";
// import { chainMap } from "./assets/chains.js";
dotenv.config();

const statusVoting = 2; //Voting Period

const VOTE_OPTION_UNSPECIFIED = 0; //no-op
const VOTE_OPTION_YES = 1; //YES
const VOTE_OPTION_ABSTAIN = 2;//abstain
const VOTE_OPTION_NO = 3;//NO
const VOTE_OPTION_NO_WITH_VETO = 4;//No with veto

async function getQueryClient(rpcEndpoint:string) {
    const tendermint34Client = await Tendermint34Client.connect(rpcEndpoint);
    const queryClient = QueryClient.withExtensions(
        tendermint34Client,
        setupBankExtension,
        setupGovExtension
    );

    return queryClient;
}

function hasVoted(client: any, proposalId:string, address:string) {
    return new Promise(async (resolve) => {
        client.gov.vote(proposalId, address).then(res => {
            resolve(res)
        }).catch(err => {
            resolve(false)
        })
    })
}

async function voteProposal(client:any, config:IChainConfiguration, proposalId:string, address:string, option:number, acountName:string) {
    let ops = [];
    let msg = {
        typeUrl: "/cosmos.gov.v1beta1.MsgVote",
        value: {
            proposalId: proposalId,
            voter: address,
            option: option
        },
    };
    ops.push(msg);
    let min_tx_fee = "0";
    if(config.tokenDenom == "uhuahua") {
        min_tx_fee = config.min_tx_fee;
    }

    const fee = {
        amount: coins(min_tx_fee, config.tokenDenom),
        gas: "" + config.gas,
    };
    console.log(`${acountName}==>${address} is ready to vote on ${config.chainName} proposal #${proposalId}`);
    let result = await client.signAndBroadcast(address, ops, fee, '');
    if (result.code == 0) {
        console.log(`${acountName}==>${address} voted ${config.chainName} proposal #${proposalId}`);
    } else {
        console.log(`${acountName}==>${address} failed to vote on ${config.chainName} proposal #${proposalId}`);
    }

}


async function start(accountConfig :IAccountConfiguration, config: IChainConfiguration) {
    const rpcEndpoint = config.rpcEndpoint;
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(accountConfig.mnemonic, { prefix: config.walletPrefix, hdPaths: config.customDerivationPath ? [stringToPath(config.customDerivationPath)] : undefined });
    setBech32NetworkPrefix( config.walletPrefix );

    // const wallet = await Secp256k1HdWallet.fromMnemonic(
    //     mnemonic,
    //     {
    //         prefix: chain.prefix
    //     }
    // );
    const [account] = await wallet.getAccounts();
    const client = await SigningStargateClient.connectWithSigner(rpcEndpoint, wallet);
    const queryClient = await getQueryClient(rpcEndpoint);
    // let balance = await queryClient.bank.balance(account.address, config.tokenDenom);
    
    const stakingBalance = TokenStakeAmounts[accountConfig.accountName + "_" + config.tokenDenom];
    
    if (stakingBalance / E6 > 1) {
        console.log(accountConfig.accountName + "_" + config.tokenDenom + String(stakingBalance));

        const proposalsVoting = await queryClient.gov.proposals(statusVoting, "", "");
        // console.log(proposalsVoting);
        for (let proposal of proposalsVoting.proposals) {
            let proposalId = proposal.proposalId.toString();

            let voted = await hasVoted(queryClient, proposalId, account.address);
            try {
                if (!voted) {
                    await voteProposal(client, config, proposalId, account.address, VOTE_OPTION_YES, accountConfig.accountName);
                }

            } catch( error : any ) {
                console.error(accountConfig.accountName)
                if(error.message !== undefined)
                  console.error(accountConfig.accountName + "==>" + error.message);
                else
                  console.error( error );
            }

        }
    }

}

// let keys = process.env.MNEMONICS.split(',');
// for (const [k, chain] of Object.entries(chainMap)) {
//     for (let key of keys) {
//         start(key, chain);
//     }
// }

const chainConfigs = require('./chainConfigs.json') as IChainConfiguration[];

const accountConfigs = require('./accountConfigs_test.json') as IAccountConfiguration[];

const TokenStakeAmounts : Record<string, number> = {};

async function InitClients( config : IChainConfiguration,accountConfig :IAccountConfiguration) : Promise<IClientInfos> {
    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(accountConfig.mnemonic, { prefix: config.walletPrefix, hdPaths: config.customDerivationPath ? [stringToPath(config.customDerivationPath)] : undefined });
    const [account] = await wallet.getAccounts();
    // console.log(account.address);
  
    setBech32NetworkPrefix( config.walletPrefix );
  
    const rpcClient = await SigningStargateClient.connectWithSigner(
      config.rpcEndpoint,
        wallet
    );
    const restClient = new cosmosclient.CosmosSDK(config.restEndpoint, config.networkName );
    
    const privKey = new proto.cosmos.crypto.secp256k1.PrivKey({
        key: await cosmosclient.generatePrivKeyFromMnemonic(accountConfig.mnemonic),
    });
    const pubKey = privKey.pubKey();
    const address = cosmosclient.AccAddress.fromPublicKey(pubKey);
  
    // console.log( `\nUsing wallet address ${address.toString()}`)
  
    return {rest:restClient, rpc: rpcClient, restAddress: address };
  }


//获取每个账户质押的token数量
async function GetStakingBalance(clients : IClientInfos, accountName: string) {
    const delegations = await rest.staking
    .delegatorDelegations( clients.rest, clients.restAddress )
    .then( res => res.data.delegation_responses );

    for(let item of delegations) {

        TokenStakeAmounts[accountName + "_" + item.balance.denom] = Number(item.balance.amount);
    }
}

async function main(){
    try {
        //query staking token amount
        for( let accountConfig of accountConfigs ){
            const chainNames = accountConfig.chainNames.split(',');
            let index = 0;

            for( let chainName of chainNames ){
                const filteredConfigs = chainConfigs.filter( (c : IChainConfiguration) => c.chainName == chainName );
                if(filteredConfigs === undefined || filteredConfigs.length == 0)
                {
                console.log(`\nCould not find configuration for chain by given name '${chainName}'! Continuing...`);
                continue;
                }
                
                const config = filteredConfigs[0];
                // const clients = await InitClients( config, parameters , accountConfig);
                const clients = await InitClients( config, accountConfig);

                await GetStakingBalance(clients, accountConfig.accountName);

            }
        }    
        console.log(TokenStakeAmounts);


        for( let accountConfig of accountConfigs ){
            // console.log(accountConfig.accountName);
            const chainNames = accountConfig.chainNames.split(',');

            for( let chainName of chainNames ){
                const filteredConfigs = chainConfigs.filter( (c : IChainConfiguration) => c.chainName == chainName );
                if(filteredConfigs === undefined || filteredConfigs.length == 0)
                {
                console.log(`\nCould not find configuration for chain by given name '${chainName}'! Continuing...`);
                continue;
                }
                
                const config = filteredConfigs[0];

                start(accountConfig, config);
            }
        }
    }catch( error : any ) {
        if(error.message !== undefined)
          console.error(error.message);
        else
          console.error( error );
      }

}

main();