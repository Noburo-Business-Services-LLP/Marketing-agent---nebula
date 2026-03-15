import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

const TermsAndConditions: React.FC = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
      {/* Header */}
      <div className={`sticky top-0 z-10 backdrop-blur-md ${theme === 'dark' ? 'bg-[#070A12]/80 border-b border-white/10' : 'bg-gray-50/80 border-b border-gray-200'}`}>
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className={`p-2 rounded-lg transition-colors ${theme === 'dark' ? 'hover:bg-white/10 text-[#ededed]' : 'hover:bg-gray-200 text-gray-900'}`}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className={`text-lg font-semibold ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
            Terms & Conditions
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className={`rounded-2xl p-8 md:p-12 ${theme === 'dark' ? 'bg-[#161b22]' : 'bg-white'} shadow-lg`}>
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className={`text-3xl md:text-4xl font-bold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
              NEBULAA Terms & Conditions of Service
            </h1>
            <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
              Effective Date: 10 March 2025 | Version 1.0
            </p>
            <p className={`text-sm mt-1 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
              Governing Entity: Noburo Business Services LLP, India
            </p>
          </div>

          <div className={`space-y-8 ${theme === 'dark' ? 'text-[#ededed]/70' : 'text-gray-600'}`}>
            {/* Preamble */}
            <p className="leading-relaxed">
              Welcome to <span className="text-[#ffcc29] font-semibold">NEBULAA</span> ("Platform", "Service", "we", "us", or "our"), an AI-powered social media marketing and management platform owned and operated by <strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Noburo Business Services LLP</strong>, a Limited Liability Partnership registered under the laws of India.
            </p>
            <p className="leading-relaxed">
              These Terms and Conditions of Service ("Terms") constitute a legally binding agreement between you ("User", "you", "your", "Client", "Subscriber") and Noburo Business Services LLP ("Company", "we", "us", "our") governing your access to and use of the NEBULAA platform, including all associated websites, applications, APIs, tools, features, and services.
            </p>
            <p className="leading-relaxed">
              By accessing, registering for, or using the Platform, you acknowledge that you have read, understood, and agree to be bound by these Terms in their entirety. If you do not agree, you must immediately cease all use of the Platform.
            </p>

            {/* Section 1 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                1. Definitions
              </h2>
              <p className="mb-3 leading-relaxed">For the purposes of these Terms:</p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"Platform"</strong> refers to the NEBULAA software application, website (nebulaa.ai), and all related tools, APIs, dashboards, and services.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"User"</strong> refers to any individual or entity who accesses or uses the Platform, whether under a free trial, paid subscription, or otherwise.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"Content"</strong> refers to all text, images, videos, graphics, data, posts, and other materials created, uploaded, shared, or generated using the Platform.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"AI-Generated Content"</strong> refers to any content produced by the Platform's artificial intelligence tools, including but not limited to captions, images, posts, strategies, analytics summaries, and recommendations.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"Subscription"</strong> refers to a paid plan that grants the User access to specific features and usage tiers of the Platform.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"Third-Party Services"</strong> refers to external platforms (e.g., Instagram, Facebook, X/Twitter, LinkedIn, Google, YouTube, etc.) integrated with NEBULAA.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"Account"</strong> refers to a registered user profile created on the Platform.</li>
                <li><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>"Services"</strong> collectively refers to all functionalities offered through the Platform, including AI content generation, social media scheduling, analytics, competitor monitoring, campaign management, and related features.</li>
              </ul>
            </section>

            {/* Section 2 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                2. Acceptance of Terms
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>By creating an account, accessing any part of the Platform, or using any of our Services, you agree to these Terms, our Privacy Policy, and any other policies referenced herein.</li>
                <li>If you are using the Platform on behalf of a company, organization, or other entity, you represent and warrant that you have the authority to bind that entity to these Terms.</li>
                <li>We reserve the right to update or modify these Terms at any time. Continued use of the Platform after changes are posted constitutes acceptance of the revised Terms.</li>
                <li>Users will be notified of material changes via email or in-app notification. It is the User's responsibility to review Terms periodically.</li>
              </ul>
            </section>

            {/* Section 3 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                3. Account Registration & Security
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                3.1 Eligibility
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>You must be at least 18 years of age or the age of legal majority in your jurisdiction to use the Platform.</li>
                <li>You must provide accurate, complete, and up-to-date information during registration.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                3.2 Account Responsibilities
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>You are solely responsible for maintaining the confidentiality of your login credentials.</li>
                <li>You agree to notify us immediately of any unauthorized access to or use of your account.</li>
                <li>We are not liable for any loss or damage arising from your failure to protect your account.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                3.3 Account Termination
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>We reserve the right to suspend or terminate accounts that violate these Terms, engage in fraudulent activity, or remain inactive for an extended period.</li>
                <li>Users may request account deletion by contacting support@nebulaa.ai.</li>
              </ul>
            </section>

            {/* Section 4 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                4. Free Trial
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>NEBULAA may offer a limited free trial period for new users to explore the Platform's features.</li>
                <li>The duration, scope, and features available during the trial may be modified at our sole discretion.</li>
                <li>No credit card or payment information is required to start a free trial unless explicitly stated.</li>
                <li>At the end of the trial period, access to premium features will be restricted unless the User subscribes to a paid plan.</li>
                <li>We reserve the right to limit, modify, or discontinue the free trial offering at any time without prior notice.</li>
                <li>Abuse of the free trial (e.g., creating multiple accounts) may result in permanent suspension.</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5. Subscriptions, Billing & Payments
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.1 Subscription Plans
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>NEBULAA offers various subscription plans with different features and usage limits.</li>
                <li>Plan details, pricing, and features are available on our website and may change at any time.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.2 Billing
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Subscriptions are billed in advance on a recurring basis (monthly or annually, depending on the selected plan).</li>
                <li>All fees are in Indian Rupees (INR) unless otherwise specified.</li>
                <li>Applicable taxes (including GST) will be added to the subscription fee.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.3 Payment Processing
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Payments are processed through secure third-party payment gateways (e.g., Razorpay).</li>
                <li>By subscribing, you authorize us to charge your selected payment method on a recurring basis.</li>
                <li>We do not store your full payment card details on our servers.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.4 Failed Payments
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>If a payment fails, we may retry the charge and/or suspend access until payment is successfully processed.</li>
                <li>Continued failure to pay may result in account downgrade or termination.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                5.5 Plan Changes
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>You may upgrade or downgrade your plan at any time through your account settings.</li>
                <li>Upgrades take effect immediately; downgrades take effect at the end of the current billing cycle.</li>
                <li>No prorated refunds are issued for downgrades or cancellations mid-cycle.</li>
              </ul>
            </section>

            {/* Section 6 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                6. Refund Policy
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>All subscription fees are generally non-refundable.</li>
                <li>Refund requests may be considered on a case-by-case basis if submitted within 7 days of the initial subscription purchase, provided the User has not extensively used the Platform's core features during that period.</li>
                <li>No refunds will be issued for partial months of service, downgraded accounts, or unused features.</li>
                <li>Refund requests should be directed to support@nebulaa.ai with your account details and reason for the request.</li>
                <li>Approved refunds will be processed within 10-15 business days to the original payment method.</li>
                <li>We reserve the right to deny refund requests that do not meet our criteria or appear to be abusive.</li>
              </ul>
            </section>

            {/* Section 7 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                7. Platform Use & Acceptable Use Policy
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                7.1 Permitted Use
              </h3>
              <p className="mb-3 leading-relaxed">You may use the Platform solely for lawful purposes related to social media marketing, content creation, scheduling, analytics, and related business activities.</p>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                7.2 Prohibited Activities
              </h3>
              <p className="mb-3 leading-relaxed">You agree NOT to:</p>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Use the Platform for any illegal, harmful, or unethical purpose.</li>
                <li>Upload, generate, or distribute content that is defamatory, obscene, hateful, discriminatory, violent, or otherwise objectionable.</li>
                <li>Attempt to reverse-engineer, decompile, or disassemble any part of the Platform.</li>
                <li>Use automated bots, scrapers, or other unauthorized tools to access the Platform.</li>
                <li>Interfere with or disrupt the Platform's infrastructure, security, or other users' experience.</li>
                <li>Resell, sublicense, or redistribute access to the Platform without our prior written consent.</li>
                <li>Violate any applicable local, state, national, or international law or regulation.</li>
                <li>Impersonate any person or entity, or falsely claim an affiliation with any person or entity.</li>
                <li>Use the Platform to send spam, unsolicited messages, or engage in any form of harassment.</li>
                <li>Circumvent or attempt to circumvent any usage limits, access controls, or security measures.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                7.3 Enforcement
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>We reserve the right to investigate and take appropriate action against any violations, including but not limited to removing content, suspending or terminating accounts, and reporting to law enforcement authorities.</li>
              </ul>
            </section>

            {/* Section 8 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                8. Intellectual Property
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                8.1 Platform IP
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>All intellectual property rights in the Platform, including but not limited to software, code, design, graphics, logos, trademarks, and documentation, are owned by Noburo Business Services LLP.</li>
                <li>Nothing in these Terms grants you any right, title, or interest in our intellectual property except for the limited license to use the Platform as described herein.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                8.2 User Content
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>You retain ownership of any original content you upload to the Platform.</li>
                <li>By uploading content, you grant us a non-exclusive, worldwide, royalty-free license to use, process, store, and display such content solely for the purpose of providing the Services.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                8.3 AI-Generated Content Ownership
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Content generated by the Platform's AI tools is provided for your use, and you may use it for your business purposes.</li>
                <li>However, we make no guarantees regarding the originality, uniqueness, or copyright status of AI-generated content.</li>
                <li>You are solely responsible for reviewing, editing, and ensuring that AI-generated content complies with applicable laws and third-party rights before publishing.</li>
              </ul>
            </section>

            {/* Section 9 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                9. AI-Generated Content Disclaimer
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>NEBULAA uses artificial intelligence and machine learning technologies to generate content, provide recommendations, and deliver insights.</li>
                <li>AI-generated outputs are provided "as-is" and may not always be accurate, complete, appropriate, or error-free.</li>
                <li>We do not guarantee that AI-generated content will be free from bias, factual errors, or inappropriate material.</li>
                <li>Users are solely responsible for reviewing, editing, verifying, and approving all AI-generated content before use or publication.</li>
                <li>NEBULAA shall not be held liable for any consequences arising from the use of AI-generated content, including but not limited to reputational damage, legal claims, or loss of business.</li>
                <li>The AI models used by the Platform may be updated, changed, or replaced at any time, which may affect the quality or nature of outputs.</li>
              </ul>
            </section>

            {/* Section 10 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                10. Data & Privacy
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your use of the Platform is also governed by our Privacy Policy, which is incorporated into these Terms by reference.</li>
                <li>By using the Platform, you consent to the collection, processing, and use of your data as described in the Privacy Policy.</li>
                <li>We implement reasonable security measures to protect your data but cannot guarantee absolute security.</li>
                <li>You are responsible for ensuring that any data you upload or process through the Platform complies with applicable data protection laws.</li>
              </ul>
            </section>

            {/* Section 11 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                11. Third-Party Integrations
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>The Platform integrates with various third-party services (e.g., Instagram, Facebook, X/Twitter, LinkedIn, Google, YouTube, and others).</li>
                <li>Your use of these integrations is subject to the respective terms of service and privacy policies of those third-party platforms.</li>
                <li>We are not responsible for the availability, accuracy, or actions of third-party services.</li>
                <li>Changes made by third-party platforms to their APIs, policies, or functionality may affect the availability or performance of certain features on NEBULAA.</li>
                <li>We do not guarantee uninterrupted integration with any third-party service and shall not be liable for any disruptions caused by third-party platform changes.</li>
              </ul>
            </section>

            {/* Section 12 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                12. Service Availability
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>We strive to maintain high availability of the Platform but do not guarantee uninterrupted, error-free, or secure access at all times.</li>
                <li>The Platform may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control.</li>
                <li>We reserve the right to modify, suspend, or discontinue any part of the Service at any time, with or without notice.</li>
                <li>We shall not be liable for any loss or inconvenience caused by downtime or service interruptions.</li>
              </ul>
            </section>

            {/* Section 13 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                13. Disclaimers of Warranty
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>THE PLATFORM AND ALL SERVICES ARE PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE.</li>
                <li>WE EXPRESSLY DISCLAIM ALL IMPLIED WARRANTIES, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND ACCURACY.</li>
                <li>WE DO NOT WARRANT THAT THE PLATFORM WILL MEET YOUR REQUIREMENTS, OPERATE WITHOUT INTERRUPTION, BE ERROR-FREE, OR THAT ANY DEFECTS WILL BE CORRECTED.</li>
                <li>NO ADVICE OR INFORMATION, WHETHER ORAL OR WRITTEN, OBTAINED FROM US SHALL CREATE ANY WARRANTY NOT EXPRESSLY STATED IN THESE TERMS.</li>
              </ul>
            </section>

            {/* Section 14 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                14. Limitation of Liability
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, NOBURO BUSINESS SERVICES LLP AND ITS OFFICERS, DIRECTORS, EMPLOYEES, PARTNERS, AND AGENTS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, REVENUE, GOODWILL, OR BUSINESS OPPORTUNITIES.</li>
                <li>OUR TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THESE TERMS OR THE USE OF THE PLATFORM SHALL NOT EXCEED THE AMOUNT PAID BY YOU TO US IN THE TWELVE (12) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.</li>
                <li>THESE LIMITATIONS APPLY REGARDLESS OF THE THEORY OF LIABILITY (CONTRACT, TORT, STRICT LIABILITY, OR OTHERWISE) AND EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</li>
                <li>SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES. IN SUCH JURISDICTIONS, OUR LIABILITY SHALL BE LIMITED TO THE MAXIMUM EXTENT PERMITTED BY LAW.</li>
              </ul>
            </section>

            {/* Section 15 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                15. Indemnification
              </h2>
              <p className="leading-relaxed mb-3">
                You agree to indemnify, defend, and hold harmless Noburo Business Services LLP, its partners, officers, directors, employees, and agents from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Your use or misuse of the Platform.</li>
                <li>Your violation of these Terms.</li>
                <li>Your violation of any applicable law or regulation.</li>
                <li>Your infringement of any third-party rights, including intellectual property rights.</li>
                <li>Any content you upload, generate, publish, or share through the Platform.</li>
                <li>Any activity conducted through your account, whether or not authorized by you.</li>
              </ul>
            </section>

            {/* Section 16 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                16. Confidentiality
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>Both parties agree to maintain the confidentiality of any proprietary or confidential information disclosed during the course of using the Platform.</li>
                <li>Confidential information does not include information that is publicly available, independently developed, or rightfully received from a third party without obligation of confidentiality.</li>
                <li>This obligation of confidentiality survives the termination of these Terms.</li>
              </ul>
            </section>

            {/* Section 17 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                17. Term & Termination
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                17.1 Term
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>These Terms are effective from the date you first access or use the Platform and remain in effect until terminated.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                17.2 Termination by User
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>You may terminate your account at any time by contacting support@nebulaa.ai or through your account settings.</li>
                <li>Termination does not entitle you to a refund of any prepaid subscription fees.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                17.3 Termination by Us
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>We may suspend or terminate your access at any time, with or without cause, and with or without notice, including but not limited to breach of these Terms.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                17.4 Effect of Termination
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Upon termination, your right to access and use the Platform immediately ceases.</li>
                <li>We may delete your account data after a reasonable retention period, subject to applicable laws.</li>
                <li>Sections of these Terms that by their nature should survive termination (e.g., Intellectual Property, Limitation of Liability, Indemnification, Confidentiality, Governing Law) shall survive.</li>
              </ul>
            </section>

            {/* Section 18 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                18. Governing Law & Dispute Resolution
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                18.1 Governing Law
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>These Terms shall be governed by and construed in accordance with the laws of India, without regard to its conflict of law principles.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                18.2 Dispute Resolution
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>Any dispute arising out of or in connection with these Terms shall first be attempted to be resolved through good faith negotiation between the parties.</li>
                <li>If the dispute cannot be resolved through negotiation within 30 days, it shall be referred to and finally resolved by arbitration in accordance with the Arbitration and Conciliation Act, 1996 of India.</li>
                <li>The seat of arbitration shall be Chennai, India.</li>
                <li>The language of arbitration shall be English.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                18.3 Jurisdiction
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>Subject to the arbitration clause above, the courts of Chennai, India shall have exclusive jurisdiction over any matters arising under these Terms.</li>
              </ul>
            </section>

            {/* Section 19 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                19. Force Majeure
              </h2>
              <ul className="list-disc pl-6 space-y-2">
                <li>We shall not be liable for any failure or delay in performing our obligations under these Terms if such failure or delay results from circumstances beyond our reasonable control, including but not limited to natural disasters, pandemics, wars, terrorism, riots, government actions, power failures, internet or telecommunications failures, cyberattacks, or acts of God.</li>
              </ul>
            </section>

            {/* Section 20 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                20. General Provisions
              </h2>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                20.1 Entire Agreement
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>These Terms, together with the Privacy Policy and any other referenced policies, constitute the entire agreement between you and Noburo Business Services LLP regarding the use of the Platform.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                20.2 Severability
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                20.3 Waiver
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>No failure or delay by us in exercising any right shall constitute a waiver of that right.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                20.4 Assignment
              </h3>
              <ul className="list-disc pl-6 space-y-2 mb-4">
                <li>You may not assign or transfer your rights under these Terms without our prior written consent. We may assign our rights and obligations without restriction.</li>
              </ul>
              <h3 className={`text-lg font-semibold mb-3 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                20.5 Notices
              </h3>
              <ul className="list-disc pl-6 space-y-2">
                <li>All notices under these Terms shall be sent to the email address associated with your account or to the contact addresses specified below.</li>
              </ul>
            </section>

            {/* Section 21 */}
            <section>
              <h2 className={`text-xl font-bold mb-4 ${theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}`}>
                21. Contact Information
              </h2>
              <p className="leading-relaxed mb-3">
                If you have any questions, concerns, or requests regarding these Terms, please contact us:
              </p>
              <div className={`rounded-lg p-5 space-y-2 ${theme === 'dark' ? 'bg-[#070A12]' : 'bg-gray-50'}`}>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Company:</strong> Noburo Business Services LLP</p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Email (Support):</strong> <a href="mailto:support@nebulaa.ai" className="text-[#ffcc29] hover:underline">support@nebulaa.ai</a></p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Email (Legal):</strong> <a href="mailto:legal@nebulaa.ai" className="text-[#ffcc29] hover:underline">legal@nebulaa.ai</a></p>
                <p><strong className={theme === 'dark' ? 'text-[#ededed]' : 'text-gray-900'}>Website:</strong> <a href="https://nebulaa.ai" target="_blank" rel="noopener noreferrer" className="text-[#ffcc29] hover:underline">nebulaa.ai</a></p>
              </div>
            </section>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-10 pb-10">
          <p className={`text-sm ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
            &copy; {new Date().getFullYear()} Noburo Business Services LLP. All rights reserved.
          </p>
          <div className={`mt-3 flex items-center justify-center gap-4 text-sm ${theme === 'dark' ? 'text-[#ededed]/50' : 'text-gray-400'}`}>
            <a href="/#/privacy-policy" className="hover:text-[#ffcc29] transition-colors">Privacy Policy</a>
            <span>|</span>
            <a href="https://nebulaa.ai" target="_blank" rel="noopener noreferrer" className="hover:text-[#ffcc29] transition-colors">nebulaa.ai</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditions;
