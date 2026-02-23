import { useI18n } from './i18n/I18nContext'
import { motion, useScroll, useTransform, Variants } from 'framer-motion'
import {
  Github,
  BookOpen,
  FileText,
  Terminal,
  Layers,
  Database,
  BrainCircuit,
  Zap,
  Workflow,
  Search,
  ShieldCheck,
  Plug,
  Activity,
  ArrowRight,
  Code
} from 'lucide-react'
import { cn } from './utils'
import { useState } from 'react'

const GITHUB_URL = 'https://github.com/hymnly133/prizm'
const DOCS_URL = 'https://github.com/hymnly133/prizm#readme'
const LICENSE_URL = 'https://github.com/hymnly133/prizm/blob/main/LICENSE'

const fadeIn: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } }
}

const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
}

function LangSwitcher() {
  const { locale, setLocale } = useI18n()
  return (
    <nav
      className="flex items-center gap-1 overflow-hidden rounded-full border border-slate-200 bg-white/60 p-1 backdrop-blur-md shadow-sm"
      aria-label="Language"
    >
      <button
        type="button"
        onClick={() => setLocale('zh')}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-300',
          locale === 'zh'
            ? 'bg-slate-900 text-white shadow-md'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
        )}
      >
        中文
      </button>
      <button
        type="button"
        onClick={() => setLocale('en')}
        className={cn(
          'rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-300',
          locale === 'en'
            ? 'bg-slate-900 text-white shadow-md'
            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
        )}
      >
        EN
      </button>
    </nav>
  )
}

function Hero() {
  const { t } = useI18n()
  const { scrollY } = useScroll()
  const y = useTransform(scrollY, [0, 500], [0, 150])
  const opacity = useTransform(scrollY, [0, 300], [1, 0])

  // Extract "WORK WITH" from subtitle to highlight it
  const subtitle = t.hero.subtitle
  const highlightRegex = /(WORK WITH|与你协作)/i
  const match = subtitle.match(highlightRegex)

  let FormattedSubtitle = () => <>{subtitle}</>
  if (match && match.index !== undefined) {
    const before = subtitle.slice(0, match.index)
    const highlight = subtitle.slice(match.index, match.index + match[0].length)
    const after = subtitle.slice(match.index + match[0].length)

    FormattedSubtitle = () => (
      <>
        {before}
        <span className="relative inline-block px-1">
          <span className="relative z-10 text-white bg-indigo-600 px-3 py-1 rounded-md shadow-md transform -skew-y-2 inline-block">
            {highlight}
          </span>
        </span>
        {after}
      </>
    )
  }

  return (
    <header className="relative min-h-[90vh] flex items-center justify-center overflow-hidden pt-24 bg-[#fafafa]">
      {/* Light Mesh Background */}
      <div className="absolute inset-0 bg-mesh-light opacity-60 pointer-events-none" />

      <motion.div
        style={{ y, opacity }}
        className="relative z-10 px-6 sm:px-12 lg:px-24 max-w-5xl mx-auto text-center"
      >
        <motion.div
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
          className="flex flex-col items-center"
        >
          <motion.div variants={fadeIn} className="flex flex-col items-center">
            <motion.h1
              variants={fadeIn}
              className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-8 text-slate-900 mt-4"
            >
              <span>{t.hero.title}</span>
            </motion.h1>
          </motion.div>

          <motion.h2
            variants={fadeIn}
            className="mt-4 text-3xl sm:text-4xl font-bold mb-10 text-slate-800"
          >
            <FormattedSubtitle />
          </motion.h2>

          <motion.p
            variants={fadeIn}
            className="mx-auto mt-2 max-w-2xl text-lg sm:text-xl text-slate-600 leading-relaxed mb-12 font-light"
          >
            {t.hero.description}
          </motion.p>

          <motion.div
            variants={fadeIn}
            className="flex flex-wrap items-center justify-center gap-4"
          >
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center gap-2 px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-full font-medium transition-all duration-300 shadow-xl shadow-slate-900/10 hover:shadow-2xl hover:shadow-slate-900/20 hover:-translate-y-0.5 overflow-hidden"
            >
              <Github className="w-5 h-5 relative z-10" />
              <span className="relative z-10">{t.cta.github}</span>
              <ArrowRight className="w-4 h-4 ml-1 relative z-10 group-hover:translate-x-1 transition-transform" />
            </a>
            <a
              href="#quickstart"
              className="flex items-center gap-2 px-8 py-4 rounded-full border border-slate-200 bg-white/80 hover:bg-slate-50 text-slate-700 font-medium transition-all duration-300 backdrop-blur-md hover:border-slate-300 hover:shadow-sm"
            >
              <Terminal className="w-5 h-5" />
              <span>{t.quickStart.title}</span>
            </a>
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Floating scroll indicator */}
      <motion.div
        animate={{ y: [0, 10, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2 text-slate-400"
      >
        <div className="w-6 h-10 border-2 border-slate-300 rounded-full flex justify-center p-1">
          <div className="w-1.5 h-1.5 bg-slate-300 rounded-full" />
        </div>
      </motion.div>
    </header>
  )
}

function Features() {
  const { t } = useI18n()
  const [activeTab, setActiveTab] = useState<'user' | 'tech'>('user')
  const [activeFeatureIndex, setActiveFeatureIndex] = useState<number | null>(null)

  const userFeatures = [
    {
      title: t.features.user1,
      desc: t.features.userDesc1,
      list: t.features.userList1,
      icon: <Database className="w-6 h-6 text-emerald-600" />,
      bg: 'bg-emerald-50 text-emerald-600'
    },
    {
      title: t.features.user2,
      desc: t.features.userDesc2,
      list: t.features.userList2,
      icon: <BookOpen className="w-6 h-6 text-indigo-600" />,
      bg: 'bg-indigo-50 text-indigo-600'
    },
    {
      title: t.features.user3,
      desc: t.features.userDesc3,
      list: t.features.userList3,
      icon: <BrainCircuit className="w-6 h-6 text-purple-600" />,
      bg: 'bg-purple-50 text-purple-600'
    },
    {
      title: t.features.user4,
      desc: t.features.userDesc4,
      list: t.features.userList4,
      icon: <Zap className="w-6 h-6 text-amber-500" />,
      bg: 'bg-amber-50 text-amber-600'
    },
    {
      title: t.features.user5,
      desc: t.features.userDesc5,
      list: t.features.userList5,
      icon: <Workflow className="w-6 h-6 text-blue-500" />,
      bg: 'bg-blue-50 text-blue-600'
    },
    {
      title: t.features.user6,
      desc: t.features.userDesc6,
      list: t.features.userList6,
      icon: <Activity className="w-6 h-6 text-rose-500" />,
      bg: 'bg-rose-50 text-rose-600'
    },
    {
      title: t.features.user7,
      desc: t.features.userDesc7,
      list: t.features.userList7,
      icon: <Search className="w-6 h-6 text-teal-600" />,
      bg: 'bg-teal-50 text-teal-600'
    },
    {
      title: t.features.user8,
      desc: t.features.userDesc8,
      list: t.features.userList8,
      icon: <Layers className="w-6 h-6 text-slate-700" />,
      bg: 'bg-slate-100 text-slate-800'
    }
  ]

  const techFeatures = [
    {
      title: t.features.tech1,
      desc: t.features.techDesc1,
      list: t.features.techList1,
      icon: <ShieldCheck className="w-6 h-6 text-emerald-600" />,
      bg: 'bg-emerald-50 text-emerald-600'
    },
    {
      title: t.features.tech2,
      desc: t.features.techDesc2,
      list: t.features.techList2,
      icon: <Plug className="w-6 h-6 text-violet-600" />,
      bg: 'bg-violet-50 text-violet-600'
    },
    {
      title: t.features.tech3,
      desc: t.features.techDesc3,
      list: t.features.techList3,
      icon: <Database className="w-6 h-6 text-amber-600" />,
      bg: 'bg-amber-50 text-amber-600'
    },
    {
      title: t.features.tech4,
      desc: t.features.techDesc4,
      list: t.features.techList4,
      icon: <Terminal className="w-6 h-6 text-slate-800" />,
      bg: 'bg-slate-200 text-slate-900'
    },
    {
      title: t.features.tech5,
      desc: t.features.techDesc5,
      list: t.features.techList5,
      icon: <Workflow className="w-6 h-6 text-blue-600" />,
      bg: 'bg-blue-50 text-blue-600'
    },
    {
      title: t.features.tech6,
      desc: t.features.techDesc6,
      list: t.features.techList6,
      icon: <Code className="w-6 h-6 text-rose-600" />,
      bg: 'bg-rose-50 text-rose-600'
    },
    {
      title: t.features.tech7,
      desc: t.features.techDesc7,
      list: t.features.techList7,
      icon: <Activity className="w-6 h-6 text-purple-600" />,
      bg: 'bg-purple-50 text-purple-600'
    },
    {
      title: t.features.tech8,
      desc: t.features.techDesc8,
      list: t.features.techList8,
      icon: <BrainCircuit className="w-6 h-6 text-teal-600" />,
      bg: 'bg-teal-50 text-teal-600'
    }
  ]

  const currentFeatures = activeTab === 'user' ? userFeatures : techFeatures
  // Select active feature logic
  const activeFeature = activeFeatureIndex !== null ? currentFeatures[activeFeatureIndex] : null

  return (
    <section
      className="relative px-6 py-24 sm:px-12 lg:px-24 bg-white"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-[90rem]">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={staggerContainer}
          className="text-center mb-16"
        >
          <motion.h2
            variants={fadeIn}
            className="text-3xl font-extrabold text-slate-900 sm:text-4xl"
            id="features-heading"
          >
            {t.features.title}
          </motion.h2>

          <motion.div variants={fadeIn} className="mt-10 flex justify-center">
            <div className="flex p-1.5 space-x-2 bg-slate-100/80 rounded-2xl shadow-inner border border-slate-200/50">
              <button
                onClick={() => {
                  setActiveTab('user')
                  setActiveFeatureIndex(null)
                }}
                className={cn(
                  'px-8 py-3.5 text-sm font-bold rounded-xl transition-all duration-300',
                  activeTab === 'user'
                    ? 'bg-white text-blue-600 shadow-md ring-1 ring-slate-200 -translate-y-0.5'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                )}
              >
                🌟 {t.features.userTab}
              </button>
              <button
                onClick={() => {
                  setActiveTab('tech')
                  setActiveFeatureIndex(null)
                }}
                className={cn(
                  'px-8 py-3.5 text-sm font-bold rounded-xl transition-all duration-300',
                  activeTab === 'tech'
                    ? 'bg-white text-indigo-600 shadow-md ring-1 ring-slate-200 -translate-y-0.5'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
                )}
              >
                🛠️ {t.features.techTab}
              </button>
            </div>
          </motion.div>
        </motion.div>

        <div className="flex flex-col lg:flex-row gap-12 items-start justify-center">
          {/* Grid Layout taking up majority width */}
          <motion.div
            key={activeTab} // Force re-render animation when tab changes
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:w-2/3"
          >
            {currentFeatures.map((item, i) => {
              const isActive = activeFeatureIndex === i
              return (
                <div
                  key={i}
                  onMouseEnter={() => setActiveFeatureIndex(i)}
                  onClick={() => setActiveFeatureIndex(i)}
                  className={cn(
                    'group relative flex flex-col items-start text-left rounded-2xl border bg-white p-6 cursor-pointer transition-all duration-300 overflow-hidden',
                    isActive
                      ? 'border-blue-400 shadow-lg shadow-blue-500/10 scale-[1.02] z-10'
                      : 'border-slate-100 hover:border-slate-300 hover:shadow-md'
                  )}
                >
                  {/* Subtle active state background indicator */}
                  {isActive && (
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent pointer-events-none" />
                  )}

                  <div
                    className={cn(
                      'mb-4 h-12 w-12 rounded-xl flex items-center justify-center transition-transform duration-500 flex-shrink-0',
                      item.bg,
                      isActive ? 'scale-110 shadow-sm' : 'group-hover:scale-110'
                    )}
                  >
                    {item.icon}
                  </div>
                  <h3
                    className={cn(
                      'text-lg font-bold mb-2 transition-colors relative z-10',
                      isActive ? 'text-blue-900' : 'text-slate-800 group-hover:text-slate-900'
                    )}
                  >
                    {item.title}
                  </h3>
                  <p className="text-slate-500 text-xs leading-relaxed line-clamp-3 relative z-10">
                    {item.desc}
                  </p>
                </div>
              )
            })}
          </motion.div>

          {/* Details Panel Sidebar / Bottom View */}
          <div className="w-full lg:w-1/3 lg:sticky lg:top-32">
            <div
              className={cn(
                'rounded-3xl border border-slate-200/60 bg-slate-50 p-8 shadow-xl shadow-slate-200/40 min-h-[400px] transition-all duration-500 relative overflow-hidden',
                !activeFeature ? 'opacity-50 grayscale flex items-center justify-center' : ''
              )}
            >
              {!activeFeature ? (
                <div className="text-center text-slate-400 flex flex-col items-center">
                  <Search className="w-12 h-12 mb-4 text-slate-300" />
                  <p className="text-lg font-medium">Hover over a feature card</p>
                  <p className="text-sm mt-1">to discover its technical capabilities.</p>
                </div>
              ) : (
                <motion.div
                  key={`${activeTab}-${activeFeatureIndex}`}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200">
                    <div
                      className={cn(
                        'h-12 w-12 rounded-xl flex items-center justify-center shadow-sm',
                        activeFeature.bg
                      )}
                    >
                      {activeFeature.icon}
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">{activeFeature.title}</h3>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 mt-1 block">
                        Detailed Capabilities
                      </span>
                    </div>
                  </div>

                  <p className="text-slate-600 text-sm leading-relaxed mb-6 italic">
                    {activeFeature.desc}
                  </p>

                  {activeFeature.list && activeFeature.list.length > 0 && (
                    <ul className="space-y-4">
                      {(activeFeature.list as string[]).map((listItem, j) => {
                        const colonIndex = listItem.indexOf(':')
                        const colonZhIndex = listItem.indexOf('：')
                        const idx = colonIndex !== -1 ? colonIndex : colonZhIndex

                        if (idx > 0 && idx < 30) {
                          const boldPart = listItem.slice(0, idx + 1)
                          const rest = listItem.slice(idx + 1)
                          return (
                            <li key={j} className="flex items-start text-sm text-slate-600">
                              <span className="text-blue-500 mr-3 font-bold select-none mt-0.5">
                                ❖
                              </span>
                              <span className="leading-relaxed">
                                <strong className="text-slate-800">{boldPart}</strong>
                                {rest}
                              </span>
                            </li>
                          )
                        }
                        return (
                          <li key={j} className="flex items-start text-sm text-slate-600">
                            <span className="text-blue-500 mr-3 font-bold select-none mt-0.5">
                              ❖
                            </span>
                            <span className="leading-relaxed">{listItem}</span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function MCPEcosystem() {
  const { t } = useI18n()

  return (
    <section className="relative px-6 py-32 sm:px-12 lg:px-24 bg-slate-900 text-slate-100 overflow-hidden">
      {/* Decorative background vectors */}
      <div className="absolute top-0 right-0 -mr-48 -mt-48 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 -ml-48 -mb-48 w-96 h-96 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="grid gap-16 lg:grid-cols-2 lg:gap-24 items-center"
        >
          <div>
            <h2 className="text-3xl font-extrabold sm:text-4xl text-white mb-6">{t.mcp.title}</h2>
            <p className="text-lg text-slate-300 leading-relaxed font-light mb-12">
              {t.mcp.description}
            </p>

            <div className="space-y-8">
              <div className="flex gap-4">
                <div className="flex-shrink-0 mt-1">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/5">
                    <Code className="w-5 h-5 text-blue-400" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">{t.mcp.cursor}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{t.mcp.cursorDesc}</p>
                </div>
              </div>

              <div className="flex gap-4">
                <div className="flex-shrink-0 mt-1">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/5">
                    <Plug className="w-5 h-5 text-indigo-400" />
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white mb-2">{t.mcp.lobechat}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{t.mcp.lobechatDesc}</p>
                </div>
              </div>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative"
          >
            <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-2 shadow-2xl backdrop-blur-xl">
              <div className="flex items-center gap-2 px-4 pb-3 pt-3 border-b border-slate-700/50">
                <div className="w-3 h-3 rounded-full bg-slate-600" />
                <div className="w-3 h-3 rounded-full bg-slate-600" />
                <div className="w-3 h-3 rounded-full bg-slate-600" />
              </div>
              <div className="p-6 font-mono text-xs sm:text-sm leading-relaxed text-slate-300">
                <div className="text-slate-500 mb-2"># MCP Protocol Connection Example</div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">1</span>
                  <span>
                    <span className="text-emerald-400">node</span> prizm/dist/mcp/stdio-bridge.js
                  </span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">2</span>
                  <span className="text-slate-500"> --env PRIZM_URL=http://127.0.0.1:4127</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">3</span>
                  <span className="text-slate-500"> --env PRIZM_SCOPE=personal</span>
                </div>
                <div className="flex mt-4">
                  <span className="text-blue-400 mr-4">4</span>
                  <span className="text-indigo-400">{'{'}</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">5</span>
                  <span className="text-indigo-400 pl-4">"mcpServers"</span>
                  <span className="text-white">: {'{'}</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">6</span>
                  <span className="text-indigo-400 pl-8">"prizm-local"</span>
                  <span className="text-white">: {'{'}</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">7</span>
                  <span className="text-indigo-400 pl-12">"command"</span>
                  <span className="text-white">: </span>
                  <span className="text-emerald-400">"node"</span>
                  <span className="text-white">,</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">8</span>
                  <span className="text-indigo-400 pl-12">"args"</span>
                  <span className="text-white">: [</span>
                  <span className="text-emerald-400">".../stdio-bridge.js"</span>
                  <span className="text-white">]</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">9</span>
                  <span className="text-white pl-8">{'}'}</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">10</span>
                  <span className="text-white pl-4">{'}'}</span>
                </div>
                <div className="flex">
                  <span className="text-blue-400 mr-4">11</span>
                  <span className="text-indigo-400">{'}'}</span>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

function Screenshots() {
  const { t } = useI18n()
  const base = import.meta.env.BASE_URL

  return (
    <section
      className="relative py-32 overflow-hidden bg-[#fafafa]"
      aria-labelledby="screenshots-heading"
    >
      <div className="relative mx-auto max-w-7xl px-6 sm:px-12 lg:px-24">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={fadeIn}
          className="text-center mb-20"
        >
          <h2
            className="text-3xl font-extrabold text-slate-900 sm:text-4xl"
            id="screenshots-heading"
          >
            {t.screenshots.title}
          </h2>
          <p className="mt-4 text-slate-500 max-w-2xl mx-auto text-lg">
            {t.screenshots.placeholder}
          </p>
        </motion.div>

        <div className="grid gap-12 lg:grid-cols-2">
          {/* Dashboard Shot */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="group"
          >
            <div className="relative rounded-2xl border border-slate-200/60 bg-white p-2 shadow-2xl shadow-slate-200/50 transition-all duration-500 hover:shadow-indigo-500/10 hover:-translate-y-1">
              {/* Browser/Window Header */}
              <div className="flex items-center gap-2 px-4 pb-3 pt-3 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
                <div className="w-3 h-3 rounded-full bg-slate-200 group-hover:bg-red-400 transition-colors" />
                <div className="w-3 h-3 rounded-full bg-slate-200 group-hover:bg-amber-400 transition-colors delay-75" />
                <div className="w-3 h-3 rounded-full bg-slate-200 group-hover:bg-green-400 transition-colors delay-150" />
              </div>
              <img
                src={`${base}screenshots/dashboard-placeholder.svg`}
                alt={t.screenshots.dashboard}
                className="w-full rounded-b-xl object-cover bg-white opacity-90 group-hover:opacity-100 transition-opacity"
                width={640}
                height={400}
              />
            </div>
            <p className="mt-6 text-center text-lg font-semibold text-slate-700">
              {t.screenshots.dashboardDesc}
            </p>
          </motion.div>

          {/* Electron Shot */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-50px' }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
            className="group mt-12 lg:mt-24"
          >
            <div className="relative rounded-2xl border border-slate-200/60 bg-white p-2 shadow-2xl shadow-slate-200/50 transition-all duration-500 hover:shadow-purple-500/10 hover:-translate-y-1">
              {/* Browser/Window Header */}
              <div className="flex items-center gap-2 px-4 pb-3 pt-3 border-b border-slate-100 bg-slate-50/50 rounded-t-xl">
                <div className="w-3 h-3 rounded-full bg-slate-200 group-hover:bg-red-400 transition-colors" />
                <div className="w-3 h-3 rounded-full bg-slate-200 group-hover:bg-amber-400 transition-colors delay-75" />
                <div className="w-3 h-3 rounded-full bg-slate-200 group-hover:bg-green-400 transition-colors delay-150" />
              </div>
              <img
                src={`${base}screenshots/electron-placeholder.svg`}
                alt={t.screenshots.electron}
                className="w-full rounded-b-xl object-cover bg-white opacity-90 group-hover:opacity-100 transition-opacity"
                width={640}
                height={400}
              />
            </div>
            <p className="mt-6 text-center text-lg font-semibold text-slate-700">
              {t.screenshots.electronDesc}
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

function QuickStart() {
  const { t } = useI18n()

  return (
    <section
      id="quickstart"
      className="relative px-6 py-32 sm:px-12 lg:px-24 bg-white border-y border-slate-100"
      aria-labelledby="quickstart-heading"
    >
      <div className="mx-auto max-w-3xl">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-extrabold text-slate-900" id="quickstart-heading">
            {t.quickStart.title}
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="rounded-2xl border border-slate-200/60 bg-white shadow-2xl shadow-slate-200/80 overflow-hidden"
        >
          {/* Terminal Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-mono font-medium text-slate-500">bash</span>
            </div>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-slate-300" />
              <div className="w-3 h-3 rounded-full bg-slate-300" />
              <div className="w-3 h-3 rounded-full bg-slate-300" />
            </div>
          </div>

          <div className="p-6 font-mono text-sm sm:text-base text-slate-700 leading-loose bg-[#fafafa]">
            <p className="text-slate-400 mb-2 font-sans text-sm"># {t.quickStart.step1}</p>
            <div className="flex items-start">
              <span className="text-blue-500 select-none mr-4 font-bold">❯</span>
              <span className="text-indigo-600 font-semibold">git clone</span>{' '}
              <span className="text-slate-600 ml-2">https://github.com/hymnly133/prizm.git</span>
            </div>
            <div className="flex items-start">
              <span className="text-blue-500 select-none mr-4 font-bold">❯</span>
              <span className="text-indigo-600 font-semibold">cd</span>{' '}
              <span className="text-slate-600 ml-2">prizm &&</span>{' '}
              <span className="text-indigo-600 font-semibold ml-2">yarn</span>{' '}
              <span className="text-slate-600 ml-2">install</span>
            </div>

            <p className="text-slate-400 mt-6 mb-2 font-sans text-sm"># {t.quickStart.step2}</p>
            <div className="flex items-start">
              <span className="text-blue-500 select-none mr-4 font-bold">❯</span>
              <span className="text-indigo-600 font-semibold">yarn</span>{' '}
              <span className="text-slate-600 ml-2">dev:server</span>
            </div>

            <p className="text-slate-400 mt-6 mb-2 font-sans text-sm"># {t.quickStart.step3}</p>
            <div className="flex items-start">
              <span className="text-blue-500 select-none mr-4 font-bold">❯</span>
              <span className="text-indigo-600 font-semibold">yarn</span>{' '}
              <span className="text-slate-600 ml-2">dev:electron</span>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-12 text-center"
        >
          <a
            href={t.quickStart.url}
            className="inline-flex items-center gap-2 px-6 py-2 rounded-full bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-mono text-base group"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.quickStart.url}
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </a>
          <p className="mt-8 text-slate-500 text-sm max-w-xl mx-auto">{t.quickStart.note}</p>
        </motion.div>
      </div>
    </section>
  )
}

function CTA() {
  const { t } = useI18n()

  const links = [
    { label: t.cta.github, href: GITHUB_URL, icon: <Github className="w-4 h-4" /> },
    { label: t.cta.docs, href: DOCS_URL, icon: <BookOpen className="w-4 h-4" /> },
    { label: t.cta.license, href: LICENSE_URL, icon: <FileText className="w-4 h-4" /> }
  ]

  return (
    <footer className="relative bg-[#fafafa] pt-24 pb-12 overflow-hidden">
      <div className="relative mx-auto flex max-w-5xl flex-col items-center px-6 sm:px-12 lg:px-24">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 mb-10">
          Ready to build with Prizm?
        </h2>

        <div className="flex flex-wrap items-center justify-center gap-4 mb-20">
          {links.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-8 py-4 text-sm font-medium text-slate-700 transition-all duration-300 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {label}
            </a>
          ))}
        </div>

        <div className="w-full flex flex-col md:flex-row items-center justify-between gap-6 pt-8 border-t border-slate-200/60">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 text-white font-bold shadow-sm">
              P
            </div>
            <span className="text-slate-700 font-semibold">Prizm Agent Environment</span>
          </div>
          <p className="text-sm text-slate-500 font-medium">
            PolyForm Noncommercial 1.0.0 · Non-commercial use only
          </p>
        </div>
      </div>
    </footer>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 selection:bg-blue-200 selection:text-blue-900">
      {/* Floating Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="fixed top-6 left-6 sm:left-10 z-50 flex items-center gap-3 pointer-events-auto"
      >
        <div className="flex items-center justify-center w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30 ring-1 ring-white/20">
          <Layers className="w-5 h-5 text-white" />
        </div>
        <div className="hidden sm:flex items-center justify-center bg-white/70 backdrop-blur-xl border border-slate-200/50 shadow-sm px-4 py-2 rounded-2xl">
          <span className="text-lg font-extrabold tracking-tight text-slate-900">Prizm</span>
        </div>
      </motion.div>

      {/* Floating Language Switcher */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="fixed top-6 right-6 sm:right-10 z-50 pointer-events-auto shadow-lg shadow-slate-200/20 rounded-full"
      >
        <LangSwitcher />
      </motion.div>

      <main className="flex flex-col">
        <Hero />
        <Features />
        <MCPEcosystem />
        <Screenshots />
        <QuickStart />
        <CTA />
      </main>
    </div>
  )
}
