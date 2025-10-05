import React, { useState } from 'react';

// Bu bileşen, dışarıdan iki özellik (prop) alacak:
// 1. onLoginSuccess: Parola doğru girildiğinde çağrılacak olan fonksiyon.
// 2. secretPass: Karşılaştırma yapacağımız doğru parola.
interface LoginScreenProps {
  onLoginSuccess: () => void;
  secretPass: string;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, secretPass }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === secretPass) {
      setError('');
      onLoginSuccess(); // Parola doğru, ana uygulamayı göstermek için sinyal gönder.
    } else {
      setError('Incorrect password. Please try again.');
      setPassword('');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm mx-auto text-center">
        <h1 className="font-serif text-4xl font-bold text-gray-800 mb-4">reAI.media</h1>
        <p className="text-gray-500 mb-8">Please enter the password to access the studio.</p>

        <form onSubmit={handleSubmit} className="bg-white p-8 rounded-2xl shadow-lg">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
          {error && <p className="text-red-500 text-sm mt-3 text-left">{error}</p>}
          <button
            type="submit"
            className="w-full mt-6 bg-gray-900 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-300 hover:bg-gray-700 active:scale-95"
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;