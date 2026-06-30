import React, { useRef } from 'react';
import { Download, ArrowLeft, FileSpreadsheet, FileText } from 'lucide-react';
import { ContentCalendar, ContentCalendarItem } from '../types';
import { getThemeClasses, useTheme } from '../context/ThemeContext';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';

interface StrategyDocumentViewProps {
  calendar: ContentCalendar;
  onBack: () => void;
}

const StrategyDocumentView: React.FC<StrategyDocumentViewProps> = ({ calendar, onBack }) => {
  const { isDarkMode } = useTheme();
  const theme = getThemeClasses(isDarkMode);
  const docRef = useRef<HTMLDivElement>(null);

  const allItems = (calendar.weeks || []).flatMap(w => w.items || []);
  const totalPosts = allItems.length;
  
  // Group by content pillar
  const pillarsMap = new Map<string, ContentCalendarItem[]>();
  allItems.forEach(item => {
    const pillar = item.contentPillar || 'General';
    if (!pillarsMap.has(pillar)) {
      pillarsMap.set(pillar, []);
    }
    pillarsMap.get(pillar)!.push(item);
  });

  const pillarStats = Array.from(pillarsMap.entries()).map(([name, items]) => {
    const count = items.length;
    const percentage = totalPosts > 0 ? Math.round((count / totalPosts) * 100) : 0;
    const examples = items.slice(0, 2).map(i => i.headline).join(' | ');
    const formats = Array.from(new Set(items.map(i => i.format))).filter(Boolean).join(', ');
    return { name, count, percentage, examples, formats };
  });

  const reelsItems = allItems.filter(item => 
    item.format?.toLowerCase().includes('reel') || 
    item.format?.toLowerCase().includes('video')
  );

  const handleDownloadPDF = async () => {
    if (!docRef.current) return;
    try {
      const canvas = await html2canvas(docRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      let heightLeft = pdfHeight;
      let position = 0;
      
      pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
      heightLeft -= pageHeight;
      
      while (heightLeft >= 0) {
        position = heightLeft - pdfHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, pdfHeight);
        heightLeft -= pageHeight;
      }
      
      pdf.save(`Nebulaa_Strategy_${calendar.month}.pdf`);
    } catch (error) {
      console.error('PDF Generation Error', error);
      alert('Failed to generate PDF');
    }
  };

  const handleDownloadExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const wsData: any[][] = [];
      
      // SECTION 1: Overview
      wsData.push(['NEBULAA MONTHLY CONTENT PLANNING SYSTEM']);
      wsData.push([]);
      wsData.push(['Business Name', calendar.businessName || '']);
      wsData.push(['Business Vertical', calendar.businessVertical || '']);
      wsData.push(['Month', calendar.month || '']);
      wsData.push(['Language', calendar.language || '']);
      wsData.push(['Target Audience', calendar.niche || '']);
      wsData.push([]);
      wsData.push(['Total Posts', totalPosts]);
      wsData.push(['Total Reels', reelsItems.length]);
      wsData.push([]);
      wsData.push([]);

      // SECTION 2: Content Pillars
      wsData.push(['CONTENT PILLARS']);
      wsData.push(['Pillar', 'Posts', 'Percentage', 'What to create', 'Examples']);
      pillarStats.forEach(p => {
        wsData.push([p.name, p.count, `${p.percentage}%`, p.formats, p.examples]);
      });
      wsData.push([]);
      wsData.push([]);

      // SECTION 3: Reels Plan
      wsData.push(['REELS & VIDEO PLAN']);
      wsData.push(['Format', 'Pillar', 'Headline', 'Creative Concept']);
      reelsItems.forEach(r => {
        wsData.push([r.format, r.contentPillar, r.headline, r.creativeConcept]);
      });
      wsData.push([]);
      wsData.push([]);

      // SECTION 4: Weekly Breakdown
      wsData.push(['WEEKLY BREAKDOWN']);
      wsData.push(['Week', 'Day', 'Format', 'Pillar', 'Headline', 'Concept', 'Objective']);
      (calendar.weeks || []).forEach(week => {
        (week.items || []).forEach(item => {
          wsData.push([`Week ${week.weekNumber}`, `Day ${item.day}`, item.format, item.contentPillar, item.headline, item.creativeConcept, item.objective]);
        });
      });

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      XLSX.utils.book_append_sheet(wb, ws, 'Strategy Plan');

      XLSX.writeFile(wb, `Nebulaa_Strategy_${calendar.month}.xlsx`);
    } catch (error) {
      console.error('Excel Export Error', error);
      alert('Failed to generate Excel file');
    }
  };

  const docTheme = isDarkMode ? 'bg-[#0a0a0a] text-slate-200' : 'bg-white text-slate-800';
  const borderTheme = isDarkMode ? 'border-slate-800' : 'border-slate-200';
  const headerBg = isDarkMode ? 'bg-slate-900' : 'bg-slate-50';

  return (
    <div className="flex flex-col w-full pb-20 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
        <button onClick={onBack} className={`flex items-center gap-2 px-4 py-2 rounded-lg border hover:bg-opacity-80 transition-colors ${theme.border} ${theme.text}`}>
          <ArrowLeft className="w-4 h-4" /> Back to Calendar
        </button>
        <div className="flex items-center gap-3">
          <button onClick={handleDownloadExcel} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-sm transition-colors">
            <FileSpreadsheet className="w-4 h-4" /> Download Excel
          </button>
          <button onClick={handleDownloadPDF} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors">
            <FileText className="w-4 h-4" /> Download PDF
          </button>
        </div>
      </div>

      <div className={`w-full max-w-4xl mx-auto rounded-xl shadow-lg border overflow-hidden ${borderTheme} ${docTheme}`}>
        {/* Document Content to capture for PDF */}
        <div ref={docRef} className="p-8 sm:p-12" style={{ backgroundColor: isDarkMode ? '#0a0a0a' : '#ffffff' }}>
          
          {/* HEADER */}
          <div className="border-b-2 border-[#ffcc29] pb-6 mb-8 text-center sm:text-left flex flex-col sm:flex-row justify-between items-end gap-4">
            <div>
              <h1 className="text-3xl font-bold font-serif mb-2 text-[#ffcc29]">NEBULAA SYSTEM</h1>
              <p className="text-xl tracking-wide uppercase font-semibold opacity-90">Monthly Content Strategy</p>
            </div>
            <div className="text-right text-sm opacity-80">
              <p className="font-semibold">{calendar.businessName || 'Your Business'}</p>
              <p>{calendar.month}</p>
              <p>{calendar.businessVertical}</p>
            </div>
          </div>

          {/* SECTION 1 */}
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-[#ffcc29] text-black w-8 h-8 rounded-full flex items-center justify-center text-sm">1</span> 
              Framework & Audience
            </h2>
            <div className={`p-5 rounded-lg border ${borderTheme} ${headerBg}`}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="block opacity-60 text-xs font-bold uppercase mb-1">Vertical</span><span className="font-medium">{calendar.businessVertical}</span></div>
                <div><span className="block opacity-60 text-xs font-bold uppercase mb-1">Language</span><span className="font-medium">{calendar.language}</span></div>
                <div><span className="block opacity-60 text-xs font-bold uppercase mb-1">Audience</span><span className="font-medium">{calendar.niche || 'General'}</span></div>
                <div><span className="block opacity-60 text-xs font-bold uppercase mb-1">Total Output</span><span className="font-medium">{totalPosts} Posts</span></div>
              </div>
            </div>
          </div>

          {/* SECTION 2 */}
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-[#ffcc29] text-black w-8 h-8 rounded-full flex items-center justify-center text-sm">2</span> 
              Content Pillars by Vertical
            </h2>
            <div className="overflow-x-auto">
              <table className={`w-full text-sm border-collapse border ${borderTheme}`}>
                <thead>
                  <tr className={headerBg}>
                    <th className={`border ${borderTheme} p-3 text-left font-bold`}>Pillar</th>
                    <th className={`border ${borderTheme} p-3 text-center font-bold`}>Posts</th>
                    <th className={`border ${borderTheme} p-3 text-center font-bold`}>%</th>
                    <th className={`border ${borderTheme} p-3 text-left font-bold`}>What to create</th>
                    <th className={`border ${borderTheme} p-3 text-left font-bold`}>Examples</th>
                  </tr>
                </thead>
                <tbody>
                  {pillarStats.map((p, i) => (
                    <tr key={i} className={`hover:bg-opacity-50 ${isDarkMode ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}`}>
                      <td className={`border ${borderTheme} p-3 font-semibold`}>{p.name}</td>
                      <td className={`border ${borderTheme} p-3 text-center`}>{p.count}</td>
                      <td className={`border ${borderTheme} p-3 text-center font-semibold text-[#ffcc29]`}>{p.percentage}%</td>
                      <td className={`border ${borderTheme} p-3`}>{p.formats}</td>
                      <td className={`border ${borderTheme} p-3 opacity-80`}>{p.examples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* SECTION 3 */}
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-[#ffcc29] text-black w-8 h-8 rounded-full flex items-center justify-center text-sm">3</span> 
              Reels & Video Plan
            </h2>
            <div className={`p-5 rounded-lg border ${borderTheme}`}>
              <p className="mb-4 font-semibold text-lg">{reelsItems.length} Reels / Videos planned</p>
              <ul className="space-y-3 text-sm">
                {reelsItems.map((r, i) => (
                  <li key={i} className="flex gap-3">
                    <div className="mt-1 w-2 h-2 rounded-full bg-[#ffcc29] shrink-0" />
                    <div>
                      <span className="font-bold">{r.contentPillar}:</span> {r.creativeConcept}
                    </div>
                  </li>
                ))}
                {reelsItems.length === 0 && (
                  <li className="opacity-60 italic">No video content specifically scheduled.</li>
                )}
              </ul>
            </div>
          </div>

          {/* SECTION 4 */}
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-[#ffcc29] text-black w-8 h-8 rounded-full flex items-center justify-center text-sm">4</span> 
              Weekly Breakdown
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {(calendar.weeks || []).map((week, i) => (
                <div key={i} className={`p-4 rounded-lg border ${borderTheme} ${headerBg}`}>
                  <h3 className="font-bold border-b border-[#ffcc29] pb-2 mb-3">Week {week.weekNumber}</h3>
                  <div className="space-y-2 text-sm">
                    <p className="font-semibold">{week.items?.length || 0} Posts Planned</p>
                    <ul className="list-disc pl-4 space-y-1 opacity-80">
                      {week.items?.slice(0, 3).map((item, j) => (
                        <li key={j}>{item.format}: {item.contentPillar}</li>
                      ))}
                      {(week.items?.length || 0) > 3 && (
                        <li className="italic">+ {(week.items?.length || 0) - 3} more...</li>
                      )}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION 5 */}
          <div className="mb-10">
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-[#ffcc29] text-black w-8 h-8 rounded-full flex items-center justify-center text-sm">5</span> 
              Festival & Local Opportunities
            </h2>
            <div className={`p-5 rounded-lg border ${borderTheme} italic opacity-80 text-sm`}>
              <p>Campaigns and festival posts are dynamically populated within the weekly schedule based on local events in {calendar.month}. Please refer to the specific dates in the Weekly Breakdown for event-specific creatives.</p>
            </div>
          </div>

          {/* SECTION 6 */}
          <div>
            <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
              <span className="bg-[#ffcc29] text-black w-8 h-8 rounded-full flex items-center justify-center text-sm">6</span> 
              AI Content Briefs
            </h2>
            <div className={`p-5 rounded-lg border ${borderTheme} text-sm`}>
              <p className="mb-3 font-semibold">Standard AI Brief Template:</p>
              <ul className="list-disc pl-5 opacity-80 space-y-1">
                <li><strong>Role:</strong> Act as a senior copywriter for {calendar.businessName}.</li>
                <li><strong>Voice:</strong> Professional, engaging, and authoritative.</li>
                <li><strong>Audience:</strong> {calendar.niche}</li>
                <li><strong>Constraint:</strong> Ensure all content is written in {calendar.language}.</li>
              </ul>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
};

export default StrategyDocumentView;
