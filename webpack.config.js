import path from 'path';
import { fileURLToPath } from 'url';
import GopeedPolyfillPlugin from 'gopeed-polyfill-webpack-plugin';

var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);

export default (_, argv) => ({
  entry: './src/index.js',
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
  },
  devtool: argv.mode === 'production' ? undefined : false,
  plugins: [new GopeedPolyfillPlugin()],
  module: {
    rules: [
      {
        test: /\.m?js$/,
        use: { loader: 'babel-loader' },
      },
    ],
  },
});
