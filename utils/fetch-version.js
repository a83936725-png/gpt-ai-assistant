import axios from 'axios';

/**
 * @returns {Promise<string>}
 */
const fetchVersion = async () => {
  const { data } = await axios.get('https://raw.githubusercontent.com/a83936725-png/gpt-ai-assistant/main/package.json');
  return data.version;
};

export default fetchVersion;
