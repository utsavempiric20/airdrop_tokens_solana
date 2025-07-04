import React from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import AirdropPage from "./pages/AirdropPage";
import "./App.css";

function App() {
  const { publicKey } = useWallet();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white/80 backdrop-blur-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1"
                  />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">
                  Solana Airdropper
                </h1>
                <p className="text-sm text-gray-500">
                  Merkle-based token distribution
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              {publicKey && (
                <div className="hidden sm:block text-sm text-gray-600">
                  Connected: {publicKey.toString().slice(0, 4)}...
                  {publicKey.toString().slice(-4)}
                </div>
              )}
              <WalletMultiButton className="!bg-gradient-to-r !from-blue-600 !to-indigo-600 !text-white !px-4 !py-2 !rounded-lg !font-medium hover:!from-blue-700 hover:!to-indigo-700 transition-all duration-200" />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {publicKey ? (
          <AirdropPage />
        ) : (
          <div className="text-center py-20">
            <div className="max-w-md mx-auto">
              <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg
                  className="w-8 h-8 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                  />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">
                Connect Your Wallet
              </h2>
              <p className="text-gray-600 mb-8">
                Connect your Solana wallet to start creating and claiming
                airdrops
              </p>
              <div className="flex justify-center">
                <WalletMultiButton className="!bg-gradient-to-r !from-blue-600 !to-indigo-600 !text-white !px-6 !py-3 !rounded-lg !font-medium hover:!from-blue-700 hover:!to-indigo-700 transition-all duration-200" />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
