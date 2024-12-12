const { ethers, network } = require("hardhat");

async function main() {
    console.log("Running on network:", network.name);

    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);

    const _tokenTotalSupply = 1 * 10 ** 9;
    const _swapFeePercentage = 1;
    const _ethAmountForLiquidity = ethers.parseEther('4');
    const _ethAmountForLiquidityFee = ethers.parseEther('0.1');
    const _ethAmountForDevReward = ethers.parseEther('0.1');

    const totalEthReserveAtMigration = _ethAmountForLiquidity + _ethAmountForLiquidityFee + _ethAmountForDevReward;
    const totalTokenReserveAtMigration = ethers.parseEther((0.2 * _tokenTotalSupply).toString()); // 20% of total supply left in pool

    const _virtualTokenReserve = ethers.parseEther(_tokenTotalSupply.toString());
    const _virtualEthReserve = (totalTokenReserveAtMigration * totalEthReserveAtMigration) / _virtualTokenReserve

    const _uniswapV2RouterAddress = "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24";
    const _feeRecipient = "0xdd0D4b40D8dCfB8741634b7432f53D36EAc1792B";
    const _feeRecipientSetter = deployer.address;

    console.log("Deploying PumpFactory...");
    const PumpFactoryContract = await ethers.getContractFactory("PumpFactory");
    const pumpFactory = await PumpFactoryContract.deploy(
        _tokenTotalSupply,
        _swapFeePercentage,
        _virtualTokenReserve,
        _virtualEthReserve,
        _ethAmountForLiquidity,
        _ethAmountForLiquidityFee,
        _ethAmountForDevReward,
        _uniswapV2RouterAddress,
        _feeRecipient,
        _feeRecipientSetter
    );

    await pumpFactory.waitForDeployment();
    console.log("PumpFactory deployed to:", pumpFactory.target);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.log("errorrrr", error);
        console.error(error);
        process.exit(1);
    });

// "npx hardhat run scripts/deployPumpFactory.js --network hardhat"
// 0x205f875c5F69b3aE4d6cf9F3962D5187Ff18fAFD   13685167
