// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IR1Token is IERC20 {
    function burn(address from, uint256 amount) external;
}

interface IUniswapV2Router {
    function getAmountsIn(
        uint256 amountOut,
        address[] calldata path
    ) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapETHForExactTokens(
        uint256 amountOut,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);
}

interface IUniswapV2Pair {
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

contract Manager3send is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    enum Tier {
        Micro,
        Standard,
        Big,
        Archive
    }

    IR1Token public r1Token;
    IERC20 public usdcToken;
    IUniswapV2Pair public uniswapPair;
    IUniswapV2Router public uniswapRouter;
    address public weth;
    mapping(Tier => uint256) public tierPrices;

    event PaymentProcessed(
        address indexed sender,
        Tier tier,
        uint256 usdcAmount,
        uint256 r1Amount
    );
    event TierPriceUpdated(
        Tier tier,
        uint256 previousAmount,
        uint256 newAmount
    );

    function initialize(
        address r1Address,
        address usdcAddress,
        address uniswapPairAddress,
        address uniswapRouterAddress,
        address wethAddress,
        uint256 microPrice_,
        uint256 standardPrice_,
        uint256 bigPrice_,
        uint256 archivePrice_
    ) external initializer {
        require(r1Address != address(0), "Manager3send: R1 address is zero");
        require(
            usdcAddress != address(0),
            "Manager3send: USDC address is zero"
        );
        require(
            uniswapPairAddress != address(0),
            "Manager3send: pair address is zero"
        );
        require(
            uniswapRouterAddress != address(0),
            "Manager3send: router address is zero"
        );
        require(
            wethAddress != address(0),
            "Manager3send: WETH address is zero"
        );
        require(microPrice_ > 0, "Manager3send: micro price is zero");
        require(standardPrice_ > 0, "Manager3send: standard price is zero");
        require(bigPrice_ > 0, "Manager3send: big price is zero");
        require(archivePrice_ > 0, "Manager3send: archive price is zero");

        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        r1Token = IR1Token(r1Address);
        usdcToken = IERC20(usdcAddress);
        uniswapPair = IUniswapV2Pair(uniswapPairAddress);
        uniswapRouter = IUniswapV2Router(uniswapRouterAddress);
        weth = wethAddress;
        _validatePairTokens(uniswapPairAddress, r1Address, usdcAddress);
        _setTierPrice(Tier.Micro, microPrice_);
        _setTierPrice(Tier.Standard, standardPrice_);
        _setTierPrice(Tier.Big, bigPrice_);
        _setTierPrice(Tier.Archive, archivePrice_);
    }

    /**
     * @notice Burns the R1 amount associated with the selected pricing tier.
     * @param tier Pricing option to charge.
     * @param maxR1Amount Maximum R1 amount the caller is willing to spend.
     */
    function transferPayment(
        Tier tier,
        uint256 maxR1Amount
    ) external nonReentrant {
        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");

        uint256 requiredR1 = _calculateR1Amount(usdcAmount);
        require(requiredR1 > 0, "Manager3send: computed amount is zero");
        require(
            requiredR1 <= maxR1Amount,
            "Manager3send: slippage limit exceeded"
        );

        IERC20(address(r1Token)).safeTransferFrom(
            _msgSender(),
            address(this),
            requiredR1
        );
        r1Token.burn(address(this), requiredR1);

        emit PaymentProcessed(_msgSender(), tier, usdcAmount, requiredR1);
    }

    function transferPaymentWithUSDC(
        Tier tier,
        uint256 minR1Amount
    ) external nonReentrant {
        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        require(minR1Amount > 0, "Manager3send: min output is zero");

        uint256 quotedR1 = _calculateR1Amount(usdcAmount);
        require(
            minR1Amount <= quotedR1,
            "Manager3send: min output too high"
        );

        usdcToken.safeTransferFrom(_msgSender(), address(this), usdcAmount);
        uint256 r1Amount = _swapUSDCForR1(usdcAmount, minR1Amount);

        r1Token.burn(address(this), r1Amount);

        emit PaymentProcessed(_msgSender(), tier, usdcAmount, r1Amount);
    }

    function transferPaymentWithETH(
        Tier tier,
        uint256 minR1Amount
    ) external payable nonReentrant {
        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        require(minR1Amount > 0, "Manager3send: min output is zero");

        uint256 quotedR1 = _calculateR1Amount(usdcAmount);
        require(
            minR1Amount <= quotedR1,
            "Manager3send: min output too high"
        );

        uint256 ethSpent = _swapETHForExactUSDC(usdcAmount);
        _refundExcessETH(ethSpent);

        uint256 r1Amount = _swapUSDCForR1(usdcAmount, minR1Amount);
        r1Token.burn(address(this), r1Amount);

        emit PaymentProcessed(_msgSender(), tier, usdcAmount, r1Amount);
    }

    function transferPaymentWithToken(
        Tier tier,
        address paymentToken,
        uint256 maxPaymentAmount,
        uint256 minR1Amount,
        address[] calldata paymentToUsdcPath
    ) external nonReentrant {
        require(paymentToken != address(0), "Manager3send: token is zero");
        require(maxPaymentAmount > 0, "Manager3send: amount is zero");

        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        require(minR1Amount > 0, "Manager3send: min output is zero");

        uint256 pathLength = paymentToUsdcPath.length;
        require(pathLength >= 2, "Manager3send: invalid path");
        require(
            paymentToUsdcPath[0] == paymentToken,
            "Manager3send: path mismatch"
        );
        require(
            paymentToUsdcPath[pathLength - 1] == address(usdcToken),
            "Manager3send: path must end in USDC"
        );

        IERC20 token = IERC20(paymentToken);
        token.safeTransferFrom(_msgSender(), address(this), maxPaymentAmount);
        _forceApprove(token, address(uniswapRouter), maxPaymentAmount);

        uint256[] memory amounts = uniswapRouter.swapTokensForExactTokens(
            usdcAmount,
            maxPaymentAmount,
            paymentToUsdcPath,
            address(this),
            block.timestamp
        );

        _forceApprove(token, address(uniswapRouter), 0);

        uint256 paymentSpent = amounts[0];
        require(paymentSpent > 0, "Manager3send: swap input is zero");
        require(
            amounts[pathLength - 1] == usdcAmount,
            "Manager3send: USDC output mismatch"
        );

        if (maxPaymentAmount > paymentSpent) {
            token.safeTransfer(_msgSender(), maxPaymentAmount - paymentSpent);
        }

        uint256 r1Amount = _swapUSDCForR1(usdcAmount, minR1Amount);
        r1Token.burn(address(this), r1Amount);

        emit PaymentProcessed(_msgSender(), tier, usdcAmount, r1Amount);
    }

    function setTierPrice(Tier tier, uint256 newAmount) external onlyOwner {
        require(newAmount > 0, "Manager3send: amount is zero");
        uint256 previousAmount = tierPrices[tier];
        _setTierPrice(tier, newAmount);
        emit TierPriceUpdated(tier, previousAmount, newAmount);
    }

    function getRequiredR1Amount(Tier tier) external view returns (uint256) {
        uint256 usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        return _calculateR1Amount(usdcAmount);
    }

    function quotePayment(
        Tier tier
    ) external view returns (Tier, uint256 usdcAmount, uint256 r1Amount) {
        usdcAmount = tierPrices[tier];
        require(usdcAmount > 0, "Manager3send: tier price is zero");
        r1Amount = _calculateR1Amount(usdcAmount);
        return (tier, usdcAmount, r1Amount);
    }

    function quotePaymentWithToken(
        Tier tier,
        address paymentToken,
        address[] calldata paymentToUsdcPath
    )
        external
        view
        returns (uint256 r1Amount, uint256 tokenAmount, uint256 usdcEquivalent)
    {
        require(paymentToken != address(0), "Manager3send: token is zero");

        usdcEquivalent = tierPrices[tier];
        require(usdcEquivalent > 0, "Manager3send: tier price is zero");

        uint256 pathLength = paymentToUsdcPath.length;
        require(pathLength >= 2, "Manager3send: invalid path");
        require(
            paymentToUsdcPath[0] == paymentToken,
            "Manager3send: path mismatch"
        );
        require(
            paymentToUsdcPath[pathLength - 1] == address(usdcToken),
            "Manager3send: path must end in USDC"
        );

        uint256[] memory amountsIn = uniswapRouter.getAmountsIn(
            usdcEquivalent,
            paymentToUsdcPath
        );
        require(
            amountsIn.length == pathLength,
            "Manager3send: router path length"
        );

        tokenAmount = amountsIn[0];
        require(tokenAmount > 0, "Manager3send: quote input is zero");

        r1Amount = _calculateR1Amount(usdcEquivalent);
        return (r1Amount, tokenAmount, usdcEquivalent);
    }

    function getReserves()
        external
        view
        returns (uint256 reserveUsdc, uint256 reserveR1)
    {
        return _getOrderedReserves();
    }

    receive() external payable {
        require(
            _msgSender() == address(uniswapRouter),
            "Manager3send: direct ETH transfer"
        );
    }

    /**
     * @dev Authorizes upgrades, restricted to the owner.
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function _calculateR1Amount(
        uint256 usdcAmount
    ) internal view returns (uint256) {
        (uint256 reserveUsdc, uint256 reserveR1) = _getOrderedReserves();
        require(reserveUsdc > 0 && reserveR1 > 0, "Manager3send: empty pool");
        return (usdcAmount * reserveR1) / reserveUsdc;
    }

    function _swapUSDCForR1(
        uint256 usdcAmount,
        uint256 minR1Amount
    ) internal returns (uint256) {
        _forceApprove(usdcToken, address(uniswapRouter), usdcAmount);

        address[] memory path = new address[](2);
        path[0] = address(usdcToken);
        path[1] = address(r1Token);

        uint256[] memory amounts = uniswapRouter.swapExactTokensForTokens(
            usdcAmount,
            minR1Amount,
            path,
            address(this),
            block.timestamp
        );

        _forceApprove(usdcToken, address(uniswapRouter), 0);

        uint256 r1Amount = amounts[amounts.length - 1];
        require(r1Amount > 0, "Manager3send: swap output is zero");
        return r1Amount;
    }

    function _swapETHForExactUSDC(
        uint256 usdcAmount
    ) internal returns (uint256 ethSpent) {
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = address(usdcToken);

        uint256[] memory amounts = uniswapRouter.swapETHForExactTokens{
            value: msg.value
        }(usdcAmount, path, address(this), block.timestamp);

        ethSpent = amounts[0];
        require(ethSpent > 0, "Manager3send: ETH input is zero");
    }

    function _refundExcessETH(uint256 ethSpent) internal {
        require(ethSpent <= msg.value, "Manager3send: overspent ETH");
        uint256 refund = msg.value - ethSpent;
        if (refund > 0) {
            Address.sendValue(payable(_msgSender()), refund);
        }
    }

    function _setTierPrice(Tier tier, uint256 newAmount) internal {
        tierPrices[tier] = newAmount;
    }

    function _getOrderedReserves()
        internal
        view
        returns (uint256 reserveUsdc, uint256 reserveR1)
    {
        IUniswapV2Pair pair = uniswapPair;
        require(
            address(pair) != address(0),
            "Manager3send: pair address is zero"
        );

        (uint112 reserve0, uint112 reserve1, ) = pair.getReserves();
        address token0 = pair.token0();
        address token1 = pair.token1();

        if (token0 == address(usdcToken) && token1 == address(r1Token)) {
            reserveUsdc = uint256(reserve0);
            reserveR1 = uint256(reserve1);
        } else if (token0 == address(r1Token) && token1 == address(usdcToken)) {
            reserveUsdc = uint256(reserve1);
            reserveR1 = uint256(reserve0);
        } else {
            revert("Manager3send: pair tokens mismatch");
        }
    }

    function _validatePairTokens(
        address pairAddress,
        address r1Address,
        address usdcAddress
    ) internal view {
        IUniswapV2Pair pair = IUniswapV2Pair(pairAddress);
        address token0 = pair.token0();
        address token1 = pair.token1();
        require(
            (token0 == r1Address && token1 == usdcAddress) ||
                (token0 == usdcAddress && token1 == r1Address),
            "Manager3send: pair tokens mismatch"
        );
    }

    function _forceApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        token.forceApprove(spender, amount);
    }
}
