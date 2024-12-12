// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPumpFactory} from "./interfaces/IPumpFactory.sol";
import {IUniswapV2Router02} from "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import {IUniswapV2Factory} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import {IUniswapV2Pair} from "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILaunch} from "./interfaces/ILaunch.sol";

import "hardhat/console.sol";

contract BondingCurve is ReentrancyGuard {
    IERC20 public immutable tokenContract;
    uint256 public ethReserve;
    uint256 public tokenReserve;

    uint256 public immutable VIRTUAL_ETH_RESERVE;
    uint256 public immutable VIRTUAL_TOKEN_RESERVE;

    uint256 public swapFeePercentage;

    uint256 public immutable ETH_AMOUNT_FOR_LIQUIDITY;
    uint256 public immutable ETH_AMOUNT_FOR_LIQUIDITY_FEE;
    uint256 public immutable ETH_AMOUNT_FOR_DEV_REWARD;
    uint256 public immutable TOTAL_ETH_TO_COMPLETE_CURVE;

    address public immutable TOKEN_DEVELOPER;

    IUniswapV2Router02 public uniswapRouter;
    IPumpFactory public factoryContract;
    bool public isActive = true;

    event LogBuy(uint256 indexed amountBought, uint256 indexed totalCost, address indexed buyer);
    event LogSell(uint256 indexed amountSell, uint256 indexed reward, address indexed seller);
    event BondingCurveComplete(address indexed tokenAddress, address indexed liquidityPoolAddress);

    /// @notice Creates a new BondingCurve instance
    /// @dev Sets up initial parameters and connects to external contracts
    /// @param _tokenDeveloper Address of the token developer
    /// @param _tokenAddress Address of the token contract
    /// @param _virtualTokenReserve Initial virtual token reserve
    /// @param _virtualEthReserve Initial virtual ETH reserve
    /// @param _swapFeePercentage Percentage fee for swaps
    /// @param _ethAmountForLiquidity ETH amount to be used for liquidity
    /// @param _ethAmountForLiquidityFee ETH amount for liquidity fee
    /// @param _ethAmountForDevReward ETH amount for developer reward
    /// @param _uniswapRouter Address of the Uniswap router
    constructor(
        address _tokenDeveloper,
        address _tokenAddress,
        uint256 _virtualTokenReserve,
        uint256 _virtualEthReserve,
        uint256 _swapFeePercentage,
        uint256 _ethAmountForLiquidity,
        uint256 _ethAmountForLiquidityFee,
        uint256 _ethAmountForDevReward,
        address _uniswapRouter
    ) {
        TOKEN_DEVELOPER = _tokenDeveloper;
        tokenContract = IERC20(_tokenAddress);

        VIRTUAL_TOKEN_RESERVE = _virtualTokenReserve;
        VIRTUAL_ETH_RESERVE = _virtualEthReserve;

        tokenReserve = _virtualTokenReserve;
        ethReserve = _virtualEthReserve;

        swapFeePercentage = _swapFeePercentage;

        ETH_AMOUNT_FOR_LIQUIDITY = _ethAmountForLiquidity;
        ETH_AMOUNT_FOR_LIQUIDITY_FEE = _ethAmountForLiquidityFee;
        ETH_AMOUNT_FOR_DEV_REWARD = _ethAmountForDevReward;

        TOTAL_ETH_TO_COMPLETE_CURVE =
            ETH_AMOUNT_FOR_LIQUIDITY + ETH_AMOUNT_FOR_LIQUIDITY_FEE + ETH_AMOUNT_FOR_DEV_REWARD + VIRTUAL_ETH_RESERVE;

        factoryContract = IPumpFactory(msg.sender);
        uniswapRouter = IUniswapV2Router02(_uniswapRouter);
    }

    /// @notice Deactivates the bonding curve
    /// @dev This function is called internally when the curve is completed
    function _deactivateBondingCurve() internal {
        isActive = false;
    }

    /// @notice Handles token purchase for a specified buyer
    /// @dev This internal function is called by the public buy functions
    /// @param buyer Address of the token buyer
    /// @return bool Returns true if the purchase was successful
    function _buyFor(address buyer) internal returns (bool) {
        require(isActive, "bonding curve must be active");
        require(msg.value > 0);

        uint256 buyFee = _calculateBuyFee(msg.value);
        uint256 effectiveEth = msg.value - buyFee;
        uint256 refund = 0;
        bool bondingCurveComplete = false;

        uint256 requiredEthToCompleteCurve = remainingEthToCompleteCurve();

        if (effectiveEth >= requiredEthToCompleteCurve) {
            effectiveEth = requiredEthToCompleteCurve;
            buyFee = _calculateBuyFee(requiredEthToCompleteCurve);

            refund = msg.value - effectiveEth - buyFee;
            bondingCurveComplete = true;
            _deactivateBondingCurve();
        }

        uint256 tokensToTransfer = _getAmountOut(effectiveEth, ethReserve, tokenReserve);

        ethReserve += effectiveEth;
        tokenReserve -= tokensToTransfer;

        require(tokenContract.transfer(buyer, tokensToTransfer), "ERC20 transfer failed");

        // Transfer fees to the fee recipient
        address feeRecipient = factoryContract.feeRecipient();
        payable(feeRecipient).transfer(buyFee);

        if (refund > 0) {
            payable(buyer).transfer(refund);
        }

        emit LogBuy(tokensToTransfer, effectiveEth + buyFee, buyer);

        if (bondingCurveComplete) {
            _completeBondingCurve();
            payable(TOKEN_DEVELOPER).transfer(ETH_AMOUNT_FOR_DEV_REWARD);
            payable(factoryContract.feeRecipient()).transfer(ETH_AMOUNT_FOR_LIQUIDITY_FEE);
        }
        return true;
    }

    /// @notice Buys tokens for a specified address
    /// @dev Can only be called by the factory contract
    /// @param buyer The address to receive the bought tokens
    /// @return A boolean indicating whether the purchase was successful
    function buy(address buyer) public payable nonReentrant returns (bool) {
        require(msg.sender == address(factoryContract), "You are not factory");
        return _buyFor(buyer);
    }

    /// @notice Buys tokens for the message sender
    /// @return A boolean indicating whether the purchase was successful
    function buy() public payable nonReentrant returns (bool) {
        return _buyFor(msg.sender);
    }

    /// @notice Sells a specified amount of tokens
    /// @param tokenAmount The amount of tokens to sell
    /// @return A boolean indicating whether the sale was successful
    function sell(uint256 tokenAmount) public nonReentrant returns (bool) {
        require(isActive, "bonding curve must be active");
        require(tokenAmount > 0);

        uint256 ethAmount = _getAmountOut(tokenAmount, tokenReserve, ethReserve);

        require(ethAmount <= address(this).balance, "Bonding curve does not have sufficient funds");

        uint256 sellFee = _calculateSellFee(ethAmount);
        uint256 effectiveEthAmount = ethAmount - sellFee;

        ethReserve -= ethAmount;
        tokenReserve += tokenAmount;

        payable(msg.sender).transfer(effectiveEthAmount);
        require(tokenContract.transferFrom(msg.sender, address(this), tokenAmount), "Sell token transfer failed");

        // Transfer fees to the fee recipient
        address feeTo = factoryContract.feeRecipient();
        payable(feeTo).transfer(sellFee);

        emit LogSell(tokenAmount, ethAmount, msg.sender);
        return true;
    }

    /// @notice Completes the bonding curve by adding liquidity to Uniswap
    /// @dev This function is called internally when the curve is filled
    function _completeBondingCurve() internal {
        uint256 ethAmountToSendLP = ETH_AMOUNT_FOR_LIQUIDITY;
        uint256 tokenAmountToSendLP = _getAmountOut(ethAmountToSendLP, ethReserve, tokenReserve);

        require(tokenContract.approve(address(uniswapRouter), tokenAmountToSendLP), "Approve failed");
        require(address(this).balance >= ethAmountToSendLP, "Insufficient ETH balance");

        uniswapRouter.addLiquidityETH{value: ethAmountToSendLP}(
            address(tokenContract), tokenAmountToSendLP, 0, 0, address(this), block.timestamp + 10 minutes
        );

        // Burn the LP tokens
        address WETH = uniswapRouter.WETH();
        IUniswapV2Factory uniswapV2Factory = IUniswapV2Factory(uniswapRouter.factory());
        IERC20 lpToken = IERC20(uniswapV2Factory.getPair(WETH, address(tokenContract)));

        bool success = lpToken.transfer(address(0), lpToken.balanceOf(address(this)));
        require(success, "Liquidity Pool burning failed");

        ILaunch(address(tokenContract)).launch();

        // emit BondingCurveComplete(address(tokenContract), address(lpToken));
    }

    /// @notice Calculates the fee for buying tokens
    /// @dev Uses the current swap fee percentage to calculate the fee
    /// @param amount The amount of ETH being used to buy tokens
    /// @return The calculated buy fee
    function _calculateBuyFee(uint256 amount) internal view returns (uint256) {
        return (amount / (100 + swapFeePercentage)) * swapFeePercentage;
    }

    /// @notice Calculates the fee for selling tokens
    /// @dev Uses the current swap fee percentage to calculate the fee
    /// @param amount The amount of tokens being sold
    /// @return The calculated sell fee
    function _calculateSellFee(uint256 amount) internal view returns (uint256) {
        return (amount * swapFeePercentage) / 100;
    }

    /// @notice Calculates the remaining ETH needed to complete the curve
    /// @dev Subtracts the current ETH reserve from the total ETH needed
    /// @return The amount of ETH needed to complete the curve
    function remainingEthToCompleteCurve() public view returns (uint256) {
        return TOTAL_ETH_TO_COMPLETE_CURVE - ethReserve;
    }

    /// @notice Calculates the output amount for a given input in a constant product market maker
    /// @dev Uses the formula (dx * y) / (x + dx) to calculate the output
    /// @param amountIn The input amount
    /// @param reserveIn The reserve of the input token
    /// @param reserveOut The reserve of the output token
    /// @return The calculated output amount
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        // (x + dx)(y - dy) = xy
        // dx.y - dx.dy - x.dy = 0
        // dx.y = dy(x + dx)
        // dx.y / (x + dx) = dy
        return (amountIn * reserveOut) / (reserveIn + amountIn);
    }

    /// @notice Prevents accidental ETH transfers to the contract
    /// @dev This function reverts all incoming ETH transfers
    receive() external payable {
        revert();
    }
}
