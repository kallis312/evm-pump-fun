require("@nomicfoundation/hardhat-toolbox");
require('dotenv').config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: "0.8.20",
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true,
            forking: {
                url: "https://mainnet.base.org",
                blockNumber: 19546699
            }
        },
        // tenderly: {
        //     url: "https://virtual.base.rpc.tenderly.co/2c0f8db6-d957-4d90-9d8f-f2c8814109b5",
        //     accounts: [process.env.PRIVATE_KEY_1, process.env.PRIVATE_KEY_2],
        //     chainId: 8454
        // },
        // base: {
        //     url: "https://base.llamarpc.com",
        //     accounts: [process.env.PRIVATE_KEY_1, process.env.PRIVATE_KEY_2],
        //     chainId: 8453
        // },
        // ethereum: {
        //     url: "https://eth.llamarpc.com",
        //     accounts: [process.env.PRIVATE_KEY_1, process.env.PRIVATE_KEY_2],
        //     chainId: 1
        // }
    },
    gasReporter: {
        enabled: true,
        currency: "USD",
        currencyDisplayPrecision: 4,
        coinmarketcap: "45afcfb7-e746-4d41-b46c-05d19d5d73aa",
        L2: "base",
        L2Etherscan: "IH8XC9YYCR6ZP5WDAKANWFG3KGZSPRDGBB",
        token: "ETH",
        gasPriceApi: "https://api.basescan.org/api?module=proxy&action=eth_gasPrice",
        showTimeSpent: true,
    },
};


// "npx hardhat run scripts/deployPumpFactory.js --network tenderly"