


export const E6 = 1000000


export interface IChainConfiguration{
    chainName : string,
    walletPrefix : string,
    networkName : string,
    tokenDenom : string,
    rpcEndpoint : string,
    restEndpoint : string,
    customDerivationPath? : string
  }

export function GenerateFee( config : IChainConfiguration ){
    let fee = "7000";
    if(config.tokenDenom == "uosmo"){
      fee = "0";
    }
  
    return {
      amount: [
        {
          denom: config.tokenDenom,
          amount: fee,
        },
      ],
      gas: "200000", // 200k
    };
  }