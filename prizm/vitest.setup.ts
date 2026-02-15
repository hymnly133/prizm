import path from 'path'
import { config as loadDotenv } from 'dotenv'

const cwd = process.cwd()
loadDotenv({ path: path.join(cwd, '.env') })
loadDotenv({ path: path.resolve(cwd, '..', '.env'), override: true })
