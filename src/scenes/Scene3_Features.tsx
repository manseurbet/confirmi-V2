import React from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, ShieldCheck, Shield, FileSpreadsheet } from 'lucide-react';

export default function Scene3_Features() {
  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center px-10"
      initial={{ opacity: 0, rotateX: 90 }}
      animate={{ opacity: 1, rotateX: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-16 max-w-6xl w-full">
        
        {/* Score Feature */}
        <motion.div 
          className="bg-[#1e293b] p-10 rounded-3xl border border-slate-700 relative overflow-hidden"
          initial={{ x: -50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#22c55e]/10 blur-3xl rounded-full" />
          <h3 className="text-3xl font-bold mb-8">Score de Fiabilité</h3>
          <div className="flex flex-col gap-4">
            <motion.div className="flex items-center gap-4 bg-slate-800/50 p-4 rounded-xl" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.0 }}>
              <ShieldCheck className="text-[#22c55e]" size={32} />
              <span className="text-lg">Client de confiance</span>
            </motion.div>
            <motion.div className="flex items-center gap-4 bg-slate-800/50 p-4 rounded-xl" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1.5 }}>
              <Shield className="text-orange-500" size={32} />
              <span className="text-lg">À vérifier</span>
            </motion.div>
            <motion.div className="flex items-center gap-4 bg-slate-800/50 p-4 rounded-xl" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 2.0 }}>
              <ShieldAlert className="text-red-500" size={32} />
              <span className="text-lg">Risque élevé</span>
            </motion.div>
          </div>
        </motion.div>

        {/* Bulk Feature */}
        <motion.div 
          className="bg-[#1e293b] p-10 rounded-3xl border border-slate-700 flex flex-col items-center justify-center text-center relative overflow-hidden"
          initial={{ x: 50, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ delay: 0.7 }}
        >
          <div className="absolute top-0 left-0 w-32 h-32 bg-blue-500/10 blur-3xl rounded-full" />
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="mb-8"
          >
            <FileSpreadsheet size={80} className="text-blue-400" />
          </motion.div>
          <h3 className="text-3xl font-bold mb-4">Envoi en masse</h3>
          <p className="text-xl text-slate-400">Importez depuis Google Sheets et envoyez à des centaines de clients en un clic.</p>
        </motion.div>

      </div>
    </motion.div>
  );
}