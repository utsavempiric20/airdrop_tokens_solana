
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
        <AirdropPage />
      </main>
    </div>
  );
}

export default App;
